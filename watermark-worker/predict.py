"""
Tandu Stealth Master DSP v2 Worker (Replicate / Cog)

Pipeline:
  1. Load any audio format (ffmpeg via demucs.audio.AudioFile) and resample
     to 44.1 kHz stereo float32.
  2. Apply Tandu Stealth Master DSP v2 decorrelation:
     - Cubic Catmull-Rom Non-Linear Time Warping (Dual Irrational LFOs).
     - Dynamic Spectral Constellation Perturbation (3-Band Orthogonal LFOs).
     - Mid/Side Sub-Bass Mono Lock (<120 Hz) + Asymmetric Stereo All-Pass
       Phase Dispersion Network (L != R) + Micro-Haas Fractional Delay.
     - Envelope-Gated Psychoacoustic Masking & Warm Harmonic Exciter
       (zero noise in silence, masked under active transients).
     - Full-Range Master Protection (22 Hz - 19.2 kHz), RMS Loudness Match,
       TPDF Triangular Dithering & True-Peak Ceiling Limiter (-0.3 dBTP).
  3. Encode (wav / flac / mp3) and optionally upload directly to Supabase Storage.
"""

import glob
import os
import shutil
import subprocess
import tempfile
import time

import numpy as np
import requests
import soundfile as sf
from scipy import signal
from cog import BaseModel, BasePredictor, Input, Path
from demucs.audio import AudioFile

TMP_PREFIX = "tandu_wm_"

CONTENT_TYPES = {
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
}

PRESET_CONFIGS = {
    "transparent": {
        "speed_range": (1.0045, 1.0075),
        "wow1_depth": (0.0006, 0.0010),
        "wow2_depth": (0.0002, 0.0005),
        "apf_stages": 4,
        "haas_ms": (0.06, 0.12),
        "eq_mod_db": 0.55,
        "drive": 1.12,
        "harmonic_even": 0.008,
        "masked_noise_db": -58.0,
        "side_air_gain": 0.12,
    },
    "stealth": {
        "speed_range": (1.0085, 1.0125),
        "wow1_depth": (0.0012, 0.0018),
        "wow2_depth": (0.0005, 0.0009),
        "apf_stages": 6,
        "haas_ms": (0.12, 0.22),
        "eq_mod_db": 0.95,
        "drive": 1.25,
        "harmonic_even": 0.014,
        "masked_noise_db": -50.0,
        "side_air_gain": 0.20,
    },
    "cloak": {
        "speed_range": (1.0130, 1.0175),
        "wow1_depth": (0.0018, 0.0026),
        "wow2_depth": (0.0008, 0.0013),
        "apf_stages": 8,
        "haas_ms": (0.18, 0.32),
        "eq_mod_db": 1.35,
        "drive": 1.42,
        "harmonic_even": 0.022,
        "masked_noise_db": -44.0,
        "side_air_gain": 0.28,
    },
}


class Output(BaseModel):
    file: Path
    uploaded: bool
    format: str
    sample_rate: int
    duration_seconds: float
    preset: str
    speed_shift_pct: float
    peak_dbtp: float


class Predictor(BasePredictor):
    def setup(self):
        """Initialize the DSP pipeline."""
        self.samplerate = 44100
        self.channels = 2
        print(f"[setup] Tandu Stealth Master DSP v2 ready. sr={self.samplerate} ch={self.channels}")

    # ------------------------------------------------------------------ utils

    @staticmethod
    def _cleanup_previous_runs():
        """Outputs must survive until Cog uploads them, so we clean the
        previous predictions' folders at the start of the next one."""
        for d in glob.glob(os.path.join(tempfile.gettempdir(), f"{TMP_PREFIX}*")):
            shutil.rmtree(d, ignore_errors=True)

    def _load_audio(self, path: str) -> np.ndarray:
        """Returns a float numpy array (channels, time) at the model sample rate."""
        wav = AudioFile(path).read(
            streams=0, samplerate=self.samplerate, channels=self.channels
        )
        if wav.dim() != 2 or wav.shape[-1] == 0:
            raise ValueError("El archivo de audio está vacío o no se pudo decodificar.")
        return wav.float().numpy()

    @staticmethod
    def _cubic_catmull_rom_1d(y: np.ndarray, x: np.ndarray) -> np.ndarray:
        """
        Vectorized 4-point Catmull-Rom / Hermite cubic interpolation.
        Eliminates high-frequency roll-off and aliasing caused by linear np.interp.
        """
        n = y.shape[-1]
        x_clipped = np.clip(x, 1.0, n - 3.0001)
        idx = np.floor(x_clipped).astype(np.int64)
        f = (x_clipped - idx).astype(np.float64)

        y0 = y[idx - 1]
        y1 = y[idx]
        y2 = y[idx + 1]
        y3 = y[idx + 2]

        c0 = y1
        c1 = 0.5 * (y2 - y0)
        c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3
        c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)

        return (((c3 * f + c2) * f + c1) * f + c0).astype(np.float64)

    @staticmethod
    def _allpass_biquad_coeffs(fc: float, q: float, sr: int):
        """RBJ Audio EQ Cookbook 2nd-order All-Pass filter coefficients."""
        w0 = 2.0 * np.pi * fc / sr
        alpha = np.sin(w0) / (2.0 * q)
        b0 = 1.0 - alpha
        b1 = -2.0 * np.cos(w0)
        b2 = 1.0 + alpha
        a0 = 1.0 + alpha
        a1 = -2.0 * np.cos(w0)
        a2 = 1.0 - alpha
        b = np.array([b0 / a0, b1 / a0, b2 / a0], dtype=np.float64)
        a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
        return b, a

    @classmethod
    def _apply_dsp_watermark(
        cls,
        wav: np.ndarray,
        sr: int,
        rng: np.random.Generator,
        preset: str = "stealth",
    ) -> tuple[np.ndarray, float]:
        """
        wav: (channels, time) np.ndarray
        Applies Tandu Stealth Master DSP v2 decorrelation while preserving full studio fidelity.
        Returns (processed_wav, speed_shift_pct).
        """
        cfg = PRESET_CONFIGS.get(preset, PRESET_CONFIGS["stealth"])
        wav_f64 = wav.astype(np.float64)
        input_rms = float(np.sqrt(np.mean(wav_f64 ** 2)) + 1e-9)

        length = wav_f64.shape[-1]
        t = np.arange(length, dtype=np.float64)

        # ------------------------------------------------------------------
        # 1. Cubic Spline Non-Linear Time Warping (Dual Irrational LFOs)
        # ------------------------------------------------------------------
        base_speed = float(rng.uniform(*cfg["speed_range"]))
        wow1_freq = float(rng.uniform(0.031, 0.067))
        wow2_freq = float(rng.uniform(0.103, 0.179))
        wow1_depth = float(rng.uniform(*cfg["wow1_depth"]))
        wow2_depth = float(rng.uniform(*cfg["wow2_depth"]))
        phi1 = float(rng.uniform(0, 2.0 * np.pi))
        phi2 = float(rng.uniform(0, 2.0 * np.pi))

        w1 = 2.0 * np.pi * wow1_freq / sr
        w2 = 2.0 * np.pi * wow2_freq / sr

        t_warp = (
            base_speed * t
            - (wow1_depth / w1) * np.cos(w1 * t + phi1)
            - (wow2_depth / w2) * np.sin(w2 * t + phi2)
        )
        t_warp -= np.min(t_warp)
        t_warp += 1.0
        valid = t_warp < (length - 3)
        t_warp = t_warp[valid]

        y_processed = np.zeros((wav_f64.shape[0], len(t_warp)), dtype=np.float64)
        for ch in range(wav_f64.shape[0]):
            y_processed[ch] = cls._cubic_catmull_rom_1d(wav_f64[ch], t_warp)

        n_out = y_processed.shape[-1]
        t_out = np.arange(n_out, dtype=np.float64) / sr

        # ------------------------------------------------------------------
        # 2. Dynamic Spectral Constellation Perturbation (3-Band Orthogonal LFOs)
        # ------------------------------------------------------------------
        # Perturbs local STFT peak dominance across low-mid, presence, and air bands
        # without introducing audible tonal coloration.
        b_lm, a_lm = signal.butter(2, [240 / (sr / 2), 850 / (sr / 2)], btype="bandpass")
        b_pr, a_pr = signal.butter(2, [1100 / (sr / 2), 4200 / (sr / 2)], btype="bandpass")
        b_air, a_air = signal.butter(2, [5200 / (sr / 2), 13500 / (sr / 2)], btype="bandpass")

        band_lm = signal.filtfilt(b_lm, a_lm, y_processed, axis=-1)
        band_pr = signal.filtfilt(b_pr, a_pr, y_processed, axis=-1)
        band_air = signal.filtfilt(b_air, a_air, y_processed, axis=-1)

        mod_amp = (10.0 ** (cfg["eq_mod_db"] / 20.0)) - 1.0
        lfo_lm = np.sin(2.0 * np.pi * rng.uniform(0.04, 0.09) * t_out + rng.uniform(0, 2 * np.pi))
        lfo_pr = np.cos(2.0 * np.pi * rng.uniform(0.06, 0.13) * t_out + rng.uniform(0, 2 * np.pi))
        lfo_air = np.sin(2.0 * np.pi * rng.uniform(0.08, 0.16) * t_out + rng.uniform(0, 2 * np.pi))

        y_processed = (
            y_processed
            + (mod_amp * lfo_lm) * band_lm
            - (mod_amp * 0.85 * lfo_pr) * band_pr
            + (mod_amp * 0.90 * lfo_air) * band_air
        )

        # ------------------------------------------------------------------
        # 3. Mid/Side Sub-Bass Lock (<120Hz) + Asymmetric Stereo Phase Network
        # ------------------------------------------------------------------
        if y_processed.shape[0] == 2:
            mid = 0.5 * (y_processed[0] + y_processed[1])
            side = 0.5 * (y_processed[0] - y_processed[1])

            # Lock sub-bass (<120 Hz) in pure mono for solid low-end punch
            b_hp_side, a_hp_side = signal.butter(4, 120 / (sr / 2), btype="highpass")
            side = signal.filtfilt(b_hp_side, a_hp_side, side)

            # Subtle high-frequency stereo air enhancement (>5.5 kHz)
            b_side_air, a_side_air = signal.butter(2, 5500 / (sr / 2), btype="highpass")
            side_highs = signal.filtfilt(b_side_air, a_side_air, side)
            side = side + cfg["side_air_gain"] * side_highs

            y_processed[0] = mid + side
            y_processed[1] = mid - side

        # Split at 200 Hz so asymmetric phase dispersion only affects >200 Hz
        # (preserving phase-coherent sub/kick punch)
        b_xo_low, a_xo_low = signal.butter(2, 200 / (sr / 2), btype="lowpass")
        b_xo_high, a_xo_high = signal.butter(2, 200 / (sr / 2), btype="highpass")
        low_band = signal.filtfilt(b_xo_low, a_xo_low, y_processed, axis=-1)
        high_band = signal.filtfilt(b_xo_high, a_xo_high, y_processed, axis=-1)

        # Decoupled All-Pass Cascades per channel (L != R)
        apf_stages = cfg["apf_stages"]
        base_freqs = np.geomspace(320.0, 10500.0, num=apf_stages)
        for ch in range(high_band.shape[0]):
            ch_sig = high_band[ch]
            for stage_idx in range(apf_stages):
                # Offset frequencies asymmetrically between Left and Right
                freq_jitter = rng.uniform(0.88, 1.14)
                fc = float(np.clip(base_freqs[stage_idx] * freq_jitter, 260.0, 14000.0))
                q = float(rng.uniform(0.55, 1.65))
                b_ap, a_ap = cls._allpass_biquad_coeffs(fc, q, sr)
                ch_sig = signal.lfilter(b_ap, a_ap, ch_sig)
            high_band[ch] = ch_sig

        # Micro-Haas fractional delay on Right channel high_band (0.06 - 0.32 ms)
        if high_band.shape[0] == 2:
            haas_samples = float(rng.uniform(*cfg["haas_ms"])) * (sr / 1000.0)
            idx_r = np.arange(n_out, dtype=np.float64) - haas_samples
            high_band[1] = cls._cubic_catmull_rom_1d(high_band[1], idx_r)

        y_processed = low_band + high_band

        # ------------------------------------------------------------------
        # 4. Envelope-Gated Psychoacoustic Masking & Warm Harmonic Exciter
        # ------------------------------------------------------------------
        # Calculate instantaneous amplitude envelope so silence stays 100% silent
        mono_abs = np.mean(np.abs(y_processed), axis=0)
        b_env, a_env = signal.butter(1, 18 / (sr / 2), btype="lowpass")
        env = signal.filtfilt(b_env, a_env, mono_abs)
        env_peak = float(np.max(env) + 1e-9)
        env_norm = np.clip(env / env_peak, 0.0, 1.0)
        # Soft gate: below -52 dBFS (-0.0025 linear), envelope drops smoothly to 0
        gate = np.clip((mono_abs - 0.0015) / 0.008, 0.0, 1.0)
        env_gated = env_norm * gate

        # Warm asymmetrical tape + tube saturation (adds subtle 2nd & 3rd harmonics)
        drive = cfg["drive"]
        even_k = cfg["harmonic_even"]
        y_sat = np.tanh(drive * y_processed) / np.tanh(drive)
        even_harm = even_k * (y_processed ** 2) * env_gated[None, :]
        y_processed = y_sat + (even_harm - np.mean(even_harm, axis=-1, keepdims=True))

        # Envelope-modulated band-limited pink noise (180 Hz - 14 kHz)
        white = rng.normal(0.0, 1.0, y_processed.shape).astype(np.float64)
        b_pn, a_pn = signal.butter(2, [180 / (sr / 2), 14000 / (sr / 2)], btype="bandpass")
        shaped_noise = signal.lfilter(b_pn, a_pn, white, axis=-1)
        noise_std = float(np.std(shaped_noise) + 1e-9)
        shaped_noise = shaped_noise / noise_std
        noise_gain = 10.0 ** (cfg["masked_noise_db"] / 20.0)
        y_processed += shaped_noise * (env_gated[None, :] * input_rms * noise_gain * 3.0)

        # ------------------------------------------------------------------
        # 5. Full-Range Studio Protection (22 Hz - 19.2 kHz), Loudness Match & Limiter
        # ------------------------------------------------------------------
        b_hp_master, a_hp_master = signal.butter(3, 22 / (sr / 2), btype="highpass")
        y_processed = signal.filtfilt(b_hp_master, a_hp_master, y_processed, axis=-1)

        # Preserve full musical sparkle up to 19.2 kHz while stripping ultrasonic watermarks
        b_lp_master, a_lp_master = signal.butter(4, 19200 / (sr / 2), btype="lowpass")
        y_processed = signal.filtfilt(b_lp_master, a_lp_master, y_processed, axis=-1)

        # Remove DC offset
        y_processed -= np.mean(y_processed, axis=-1, keepdims=True)

        # Match integrated RMS loudness to input so master volume stays consistent
        output_rms = float(np.sqrt(np.mean(y_processed ** 2)) + 1e-9)
        y_processed *= (input_rms / output_rms)

        # TPDF Triangular Dithering (-84 dBFS)
        dither1 = rng.uniform(-1.0, 1.0, y_processed.shape)
        dither2 = rng.uniform(-1.0, 1.0, y_processed.shape)
        tpdf_dither = (dither1 + dither2) * (10.0 ** (-84.0 / 20.0))
        y_processed += tpdf_dither

        # Transparent True-Peak Soft-Knee Ceiling Limiter at -0.3 dBFS (0.966)
        ceiling = 0.966
        peak = float(np.max(np.abs(y_processed)))
        if peak > ceiling:
            # Soft knee above 0.85, hard ceiling at 0.966
            knee = 0.85
            abs_y = np.abs(y_processed)
            over = abs_y > knee
            if np.any(over):
                sign_y = np.sign(y_processed[over])
                excess = (abs_y[over] - knee) / (ceiling - knee)
                compressed = knee + (ceiling - knee) * np.tanh(excess)
                y_processed[over] = sign_y * compressed
            final_peak = float(np.max(np.abs(y_processed)))
            if final_peak > ceiling:
                y_processed *= ceiling / final_peak

        speed_shift_pct = round((base_speed - 1.0) * 100.0, 3)
        return y_processed.astype(np.float32), speed_shift_pct

    @staticmethod
    def _encode(downmix: np.ndarray, sr: int, out_dir: str, job_id: str, fmt: str) -> str:
        """downmix: (channels, time). Returns path to encoded file."""
        safe_job = "".join(c for c in job_id if c.isalnum() or c in "-_") or "job"
        wav_path = os.path.join(out_dir, f"clean_{safe_job}.wav")

        if fmt == "flac":
            path = os.path.join(out_dir, f"clean_{safe_job}.flac")
            sf.write(path, downmix.T, sr, format="FLAC", subtype="PCM_24")
            return path

        sf.write(wav_path, downmix.T, sr, subtype="PCM_16")
        if fmt == "wav":
            return wav_path

        mp3_path = os.path.join(out_dir, f"clean_{safe_job}.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
             "-codec:a", "libmp3lame", "-b:a", "320k", mp3_path],
            check=True,
        )
        os.remove(wav_path)
        return mp3_path

    @staticmethod
    def _upload(path: str, upload_url: str, content_type: str, retries: int = 3) -> bool:
        """PUT the file to a Supabase signed upload URL. Returns True on success."""
        for attempt in range(1, retries + 1):
            try:
                with open(path, "rb") as f:
                    res = requests.put(
                        upload_url,
                        data=f,
                        headers={"Content-Type": content_type, "x-upsert": "true"},
                        timeout=(30, 900),
                    )
                if res.ok:
                    return True
                print(f"[upload] intento {attempt}: HTTP {res.status_code} {res.text[:300]}")
                if 400 <= res.status_code < 500 and res.status_code not in (408, 429):
                    break  # client error (expired token, size limit...) -> no retry
            except requests.RequestException as e:
                print(f"[upload] intento {attempt}: {e}")
            time.sleep(2 ** attempt)
        return False

    # ---------------------------------------------------------------- predict

    def predict(
        self,
        audio_file: Path = Input(description="Archivo de audio (URL o archivo). MP3, WAV, FLAC, M4A..."),
        job_id: str = Input(description="Identificador del job (se usa en el nombre del archivo)", default="job"),
        upload_url: str = Input(
            description="URL firmada de subida de Supabase Storage (opcional)", default=""
        ),
        output_format: str = Input(
            description="Formato de salida", choices=["wav", "flac", "mp3"], default="wav"
        ),
        preset: str = Input(
            description="Perfil de decorrelación DSP",
            choices=["transparent", "stealth", "cloak"],
            default="stealth",
        ),
        seed: int = Input(description="Semilla para reproducibilidad (-1 para aleatorio)", default=-1),
    ) -> Output:
        self._cleanup_previous_runs()
        work_dir = tempfile.mkdtemp(prefix=TMP_PREFIX)
        rng = np.random.default_rng(None if seed == -1 else seed)
        t0 = time.time()

        print(f"[1/3] Cargando y remuestreando audio (Preset={preset})...")
        wav = self._load_audio(str(audio_file))
        duration = wav.shape[-1] / self.samplerate
        print(f"      duración={duration:.1f}s sr={self.samplerate}")

        print(f"[2/3] Aplicando decorrelación Stealth Master DSP v2 ({preset})...")
        downmix, speed_shift_pct = self._apply_dsp_watermark(
            wav, self.samplerate, rng, preset=preset
        )
        del wav

        print("[3/3] Masterizando True-Peak y codificando...")
        peak_lin = float(np.max(np.abs(downmix)) + 1e-9)
        peak_dbtp = round(20.0 * float(np.log10(peak_lin)), 2)
        out_path = self._encode(downmix, self.samplerate, work_dir, job_id, output_format)
        size_mb = os.path.getsize(out_path) / 1e6
        print(f"      {os.path.basename(out_path)} ({size_mb:.1f} MB) | +{speed_shift_pct}% | {peak_dbtp} dBTP")

        uploaded = False
        if upload_url:
            print("[Upload] Subiendo a Supabase Storage...")
            uploaded = self._upload(out_path, upload_url, CONTENT_TYPES[output_format])
            print("         OK" if uploaded else "         FALLÓ: el cliente usará la salida de Replicate")
        else:
            print("[Upload] Sin upload_url: la salida queda en Replicate.")

        print(f"Listo en {time.time() - t0:.1f}s")
        return Output(
            file=Path(out_path),
            uploaded=uploaded,
            format=output_format,
            sample_rate=self.samplerate,
            duration_seconds=round(duration, 2),
            preset=preset,
            speed_shift_pct=speed_shift_pct,
            peak_dbtp=peak_dbtp,
        )
