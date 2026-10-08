"""
Tandu DSP Watermark Worker (Replicate / Cog)

Pipeline:
  1. Load any audio format (ffmpeg via demucs.audio.AudioFile) and resample
     to the native sample rate (44.1 kHz) and channel count (stereo).
  2. Apply DSP decorrelation on the master track:
     - Varispeed (resampling) to shift pitch and tempo by ~1%.
     - Cascaded All-Pass Filters to alter the phase response invisibly.
  3. Reconstruct, peak-limit, encode (wav / flac / mp3).
  4. Optionally PUT the result to a Supabase signed upload URL.
"""

import glob
import os
import shutil
import subprocess
import tempfile
import time
from typing import Optional

import librosa
import numpy as np
import requests
import soundfile as sf
import torch
from scipy import signal
from cog import BaseModel, BasePredictor, Input, Path
from demucs.audio import AudioFile

TMP_PREFIX = "tandu_wm_"

CONTENT_TYPES = {
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
}


class Output(BaseModel):
    file: Path
    uploaded: bool
    format: str
    sample_rate: int
    duration_seconds: float


class Predictor(BasePredictor):
    def setup(self):
        """Initialize the DSP pipeline."""
        self.samplerate = 44100
        self.channels = 2
        print(f"[setup] DSP Watermark ready. sr={self.samplerate} ch={self.channels}")

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
    def _apply_dsp_watermark(wav: np.ndarray, sr: int, rng: np.random.Generator) -> np.ndarray:
        """
        wav: (channels, time) np.ndarray
        Applies Military-Grade DSP decorrelation:
        1. Wow & Flutter (Dynamic Varispeed via non-linear interpolation)
        2. Dynamic Spectral Shaping (LFO EQ)
        3. Cascaded All-Pass Filters
        4. Psychoacoustic Noise Injection
        AND applies the requested DSP modifications for asynchronous correlation:
        - Tape Saturation & Background Noise
        - Mid/Side Processing (Mono lows, Side EQ)
        - Dynamic EQ / Multiband for Bass
        - Aggressive LPF & Master HPF/LPF
        - Dithering
        """
        from scipy import signal
        import numpy as np
        
        length = wav.shape[-1]
        t = np.arange(length)
        
        # 1. Wow & Flutter (Dynamic Varispeed)
        # Bends time continuously. Completely breaks relative-timing fingerprinting.
        wow_freq = rng.uniform(0.05, 0.2)
        wow_depth = rng.uniform(0.003, 0.008)
        base_speed = rng.uniform(1.008, 1.015)
        phase_offset = rng.uniform(0, 2 * np.pi)
        
        w = 2 * np.pi * wow_freq / sr
        t_warp = base_speed * t - (wow_depth / w) * np.cos(w * t + phase_offset)
        t_warp -= np.min(t_warp)
        valid = t_warp < (length - 1)
        t_warp = t_warp[valid]
        
        y_processed = np.zeros((wav.shape[0], len(t_warp)), dtype=np.float32)
        for ch in range(wav.shape[0]):
            y_processed[ch] = np.interp(t_warp, t, wav[ch])
            
        # 2. Dynamic Spectral Shaping (LFO EQ crossfading)
        # Slowly shifts spectral energy to confuse magnitude-peak hashing.
        b_high, a_high = signal.butter(2, 3000 / (sr / 2), btype='highpass')
        y_high = signal.filtfilt(b_high, a_high, y_processed, axis=-1)
        
        b_low, a_low = signal.butter(2, 300 / (sr / 2), btype='lowpass')
        y_low = signal.filtfilt(b_low, a_low, y_processed, axis=-1)
        
        eq_lfo = np.sin(2 * np.pi * rng.uniform(0.02, 0.1) * np.arange(y_processed.shape[-1]) / sr)
        eq_depth = rng.uniform(0.05, 0.15)
        # Vectorized crossfade
        y_processed = y_processed + (eq_depth * eq_lfo * y_high) - (eq_depth * eq_lfo * y_low)

        # 3. Cascaded All-Pass Filters
        # Obliterates phase-coded watermarks.
        for _ in range(3):
            fc = rng.uniform(300, 8000)
            Q = rng.uniform(0.5, 1.5)
            w0 = 2 * np.pi * fc / sr
            alpha = np.sin(w0) / (2 * Q)
            
            b0 = 1 - alpha
            b1 = -2 * np.cos(w0)
            b2 = 1 + alpha
            a0 = 1 + alpha
            a1 = -2 * np.cos(w0)
            a2 = 1 - alpha
            
            b = [b0/a0, b1/a0, b2/a0]
            a = [1.0, a1/a0, a2/a0]
            
            y_processed = signal.lfilter(b, a, y_processed, axis=-1)
            
        # 4. Inaudible Noise Injection (Dithering from original)
        # Masks spread-spectrum data hidden in the noise floor.
        noise = rng.normal(0, 1, y_processed.shape).astype(np.float32)
        b_noise, a_noise = signal.butter(1, 8000 / (sr / 2), btype='lowpass')
        noise = signal.lfilter(b_noise, a_noise, noise, axis=-1)
        noise_level = 10 ** (-60 / 20)  # -60 dBFS
        y_processed += noise * noise_level

        # --- APLICAMOS LA CADENA DE MASTERIZACIÓN SOLICITADA ---
        # Usamos float64 para mayor estabilidad en los filtros IIR de baja frecuencia
        y_processed = y_processed.astype(np.float64)
        
        # 5. Analog tape saturation (Soft clipping) & Subtle Background Noise
        # Enmascara las frecuencias delatoras en los agudos.
        drive = 1.5
        y_processed = np.tanh(drive * y_processed) / np.tanh(drive)
        bg_noise = rng.normal(0, 1, y_processed.shape).astype(np.float64)
        bg_noise_level = 10 ** (-70 / 20)  # -70 dBFS ruido de fondo constante
        y_processed += bg_noise * bg_noise_level

        # 6. Mid/Side Processor
        # Colapsar frecuencias bajas (bombo y bajo < 120Hz) a mono y ecualizar Side
        if y_processed.shape[0] == 2:
            mid = (y_processed[0] + y_processed[1]) / 2.0
            side = (y_processed[0] - y_processed[1]) / 2.0
            
            # Filtro de paso alto en Side a 120Hz (colapsa graves a mono)
            b_hp_side, a_hp_side = signal.butter(4, 120 / (sr / 2), btype='highpass')
            side = signal.filtfilt(b_hp_side, a_hp_side, side)
            
            # Ecualización en Side para darle amplitud real (realce de frecuencias altas)
            b_side_eq, a_side_eq = signal.butter(2, 4000 / (sr / 2), btype='highpass')
            side_highs = signal.filtfilt(b_side_eq, a_side_eq, side)
            side = side + 0.5 * side_highs
            
            y_processed[0] = mid + side
            y_processed[1] = mid - side
            
        # 7. Ecualizador dinámico / Compresor multibanda (Atenuar graves 60Hz - 250Hz)
        b_bass, a_bass = signal.butter(2, [60 / (sr / 2), 250 / (sr / 2)], btype='bandpass')
        bass_band = signal.filtfilt(b_bass, a_bass, y_processed, axis=-1)
        attenuation_linear = 10 ** (-4 / 20) # Atenúa en aprox 4dB la región
        y_processed = y_processed - bass_band + (bass_band * attenuation_linear)

        # 8. Filtro de paso bajo (Low-Pass) cortando agresivamente por encima de los 13 kHz
        b_agg_lp, a_agg_lp = signal.butter(6, 13000 / (sr / 2), btype='lowpass')
        y_processed = signal.filtfilt(b_agg_lp, a_agg_lp, y_processed, axis=-1)

        # 9. Filtros en el canal maestro: Paso alto (<30Hz) y Paso bajo (>17.5kHz)
        b_hp_master, a_hp_master = signal.butter(4, 30 / (sr / 2), btype='highpass')
        y_processed = signal.filtfilt(b_hp_master, a_hp_master, y_processed, axis=-1)
        
        # Filtro de paso bajo a 17.5kHz
        b_lp_master, a_lp_master = signal.butter(4, 17500 / (sr / 2), btype='lowpass')
        y_processed = signal.filtfilt(b_lp_master, a_lp_master, y_processed, axis=-1)
        
        # 10. Dithering al exportar
        dither_noise = rng.normal(0, 1, y_processed.shape).astype(np.float64)
        dither_level = 10 ** (-80 / 20)  # -80 dBFS
        y_processed += dither_noise * dither_level

        return y_processed.astype(np.float32)

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
        seed: int = Input(description="Semilla para reproducibilidad (-1 para aleatorio)", default=-1),
    ) -> Output:
        self._cleanup_previous_runs()
        work_dir = tempfile.mkdtemp(prefix=TMP_PREFIX)
        rng = np.random.default_rng(None if seed == -1 else seed)
        t0 = time.time()

        print("[1/3] Cargando y remuestreando audio...")
        wav = self._load_audio(str(audio_file))
        duration = wav.shape[-1] / self.samplerate
        print(f"      duración={duration:.1f}s sr={self.samplerate}")

        print("[2/3] Aplicando decorrelación DSP en la pista maestra...")
        downmix = self._apply_dsp_watermark(wav, self.samplerate, rng)
        del wav

        print("[3/3] Reconstruyendo y codificando...")
        downmix -= downmix.mean(axis=-1, keepdims=True)  # remove DC
        peak = float(np.max(np.abs(downmix)))
        if peak > 0.99:
            downmix *= 0.99 / peak
        out_path = self._encode(downmix, self.samplerate, work_dir, job_id, output_format)
        size_mb = os.path.getsize(out_path) / 1e6
        print(f"      {os.path.basename(out_path)} ({size_mb:.1f} MB)")

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
        )
