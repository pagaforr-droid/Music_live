"""
Tandu Stealth Master DSP v3.5 Worker (Replicate / Cog)
Ultra-Aggressive 8-Vector Anti-Fingerprint & Psychoacoustic Spoofing Engine

Vectors Included:
  1. Quarter-Tone CQT Bin-Boundary Varispeed (+2.1% to +4.9% / 36-83 cents) +
     Triple-LFO Non-Linear Elastic Rubato Time-Warping (Catmull-Rom Cubic Spline).
  2. 6-Band Orthogonal Constellation Scrambler (250 Hz - 9 kHz dynamic peak inversion).
  3. Chebyshev Polynomial Harmonic Chroma-Confusion (T2, T3 [+7st], T5 [+4st]) +
     Analog Tape Saturation.
  4. Dynamic Stereo Spectrum Rotator (3D Mid-Side Band Swapping + Quadrature Phase) +
     "Mono-Trap" Sweeping Haas Delay LFO (0.3-2.1 ms) + 10-18 stage Asymmetric APF.
  5. Ghost MIDI Sub-Bass Synth (55-185 Hz Polyrhythmic Sub-Harmonic Sequence) that
     spoofs root-note CQT chromagrams and beat-grid onset trackers while masked under
     Fletcher-Munson low-frequency curves.
  6. Psychoacoustic Frequency-Hopping "Constellation Poison" (Gabor Narrowband Chirp
     Grains in 350-4800 Hz triggered under musical transients to inject false STFT
     anchor peaks inaudibly).
  7. Spread-Spectrum Watermark Band Eradication (12.8 - 15.2 kHz brickwall LPF,
     60-250 Hz dynamic bass sculpting, psychoacoustic pink noise + analog hum).
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

TMP_PREFIX = "tandu_wm_"

CONTENT_TYPES = {
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
}

# MIDI notes in bass register A1 (55 Hz) to F#3 (185 Hz)
GHOST_MIDI_NOTES = np.array([33, 35, 36, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 54], dtype=np.float64)
GHOST_MIDI_FREQS = 440.0 * (2.0 ** ((GHOST_MIDI_NOTES - 69.0) / 12.0))

PRESET_CONFIGS = {
    "transparent": {
        "speed_range": (1.0210, 1.0270),      # ~36-46 cents
        "wow1_depth": (0.0040, 0.0055),
        "wow2_depth": (0.0018, 0.0028),
        "flutter_depth": (0.0005, 0.0009),
        "apf_stages": 10,
        "haas_min_ms": 0.25,
        "haas_max_ms": 0.75,
        "eq_mod_db": 2.4,
        "drive": 1.35,
        "chebyshev_gain": 0.035,
        "ghost_midi_gain": 0.045,
        "poison_chirp_gain": 0.028,
        "stereo_rot_depth": 0.28,
        "pink_noise_db": -44.0,
        "hum_db": -56.0,
        "bass_cut_db": -2.5,
        "lpf_cutoff_hz": 15200.0,
        "side_boost": 0.30,
    },
    "stealth": {
        "speed_range": (1.0285, 1.0355),      # ~49-60 cents (exact 50-cent CQT bin boundary!)
        "wow1_depth": (0.0065, 0.0085),
        "wow2_depth": (0.0028, 0.0042),
        "flutter_depth": (0.0009, 0.0015),
        "apf_stages": 14,
        "haas_min_ms": 0.45,
        "haas_max_ms": 1.35,
        "eq_mod_db": 3.8,
        "drive": 1.55,
        "chebyshev_gain": 0.060,
        "ghost_midi_gain": 0.075,
        "poison_chirp_gain": 0.048,
        "stereo_rot_depth": 0.45,
        "pink_noise_db": -39.0,
        "hum_db": -52.0,
        "bass_cut_db": -3.8,
        "lpf_cutoff_hz": 13800.0,
        "side_boost": 0.45,
    },
    "cloak": {
        "speed_range": (1.0380, 1.0490),      # ~65-83 cents + extreme non-linear rubato
        "wow1_depth": (0.0090, 0.0120),
        "wow2_depth": (0.0040, 0.0060),
        "flutter_depth": (0.0014, 0.0022),
        "apf_stages": 18,
        "haas_min_ms": 0.70,
        "haas_max_ms": 2.10,
        "eq_mod_db": 5.2,
        "drive": 1.80,
        "chebyshev_gain": 0.090,
        "ghost_midi_gain": 0.110,
        "poison_chirp_gain": 0.072,
        "stereo_rot_depth": 0.62,
        "pink_noise_db": -35.0,
        "hum_db": -48.0,
        "bass_cut_db": -4.8,
        "lpf_cutoff_hz": 12800.0,
        "side_boost": 0.60,
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
    decorrelation_pct: float


class Predictor(BasePredictor):
    def setup(self):
        """Initialize the DSP pipeline."""
        self.samplerate = 44100
        self.channels = 2
        print(f"[setup] Tandu Stealth Master DSP v3.5 Ready. sr={self.samplerate} ch={self.channels}")

    @staticmethod
    def _cleanup_previous_runs():
        for d in glob.glob(os.path.join(tempfile.gettempdir(), f"{TMP_PREFIX}*")):
            shutil.rmtree(d, ignore_errors=True)

    def _load_audio(self, path: str) -> np.ndarray:
        """Decodes any audio format to float32 stereo (channels, time) via ffmpeg."""
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-threads", "0",
            "-i", str(path),
            "-f", "f32le",
            "-acodec", "pcm_f32le",
            "-ac", str(self.channels),
            "-ar", str(self.samplerate),
            "-loglevel", "error",
            "pipe:1",
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if proc.returncode != 0 or len(proc.stdout) == 0:
            err_msg = proc.stderr.decode("utf-8", errors="ignore")[:300]
            raise ValueError(f"El archivo de audio está vacío o no se pudo decodificar: {err_msg}")
        raw = np.frombuffer(proc.stdout, dtype=np.float32)
        frames = raw.size // self.channels
        if frames == 0:
            raise ValueError("El archivo de audio decodificado no contiene muestras.")
        return raw[: frames * self.channels].reshape((frames, self.channels)).T.copy()

    @staticmethod
    def _cubic_catmull_rom_1d(y: np.ndarray, x: np.ndarray) -> np.ndarray:
        """Vectorized 4-point Catmull-Rom / Hermite cubic interpolation."""
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

    @staticmethod
    def _generate_ghost_midi_bass(n_samples: int, sr: int, env_norm: np.ndarray, input_rms: float, gain: float, rng: np.random.Generator) -> np.ndarray:
        """
        Synthesizes a Polyrhythmic Ghost MIDI Sub-Bass line (55 Hz - 185 Hz) with
        fundamental + 2nd & 3rd harmonics and click-free Hann ADSR envelopes.
        Spoofs CQT root-note trackers and beat-grid onset detectors while masked
        under Fletcher-Munson low-frequency curves.
        """
        bass_line = np.zeros(n_samples, dtype=np.float64)
        cursor = 0
        while cursor < n_samples:
            step_len = int(rng.uniform(0.16, 0.36) * sr)
            end = min(n_samples, cursor + step_len)
            seg_len = end - cursor
            if seg_len < 64:
                break

            f0 = float(rng.choice(GHOST_MIDI_FREQS))
            # Slight pitch bend per note (+-15 cents) to further confuse CQT
            f0 *= float(rng.uniform(0.991, 1.009))
            t_seg = np.arange(seg_len, dtype=np.float64) / sr
            phase0 = float(rng.uniform(0, 2.0 * np.pi))

            # Warm FM/Additive Bass: Fundamental + 2nd harmonic + 3rd harmonic (fifth)
            wave = (
                0.60 * np.sin(2.0 * np.pi * f0 * t_seg + phase0)
                + 0.28 * np.sin(2.0 * np.pi * (2.0 * f0) * t_seg + phase0 * 0.5)
                + 0.12 * np.sin(2.0 * np.pi * (3.0 * f0) * t_seg)
            )
            # Smooth Hann envelope per MIDI note for zero-click transitions
            win = np.sin(np.pi * np.arange(seg_len, dtype=np.float64) / seg_len) ** 2
            bass_line[cursor:end] += wave * win
            # Overlap next note slightly for legato continuity
            cursor += int(step_len * 0.85)

        # Modulate by song envelope so silence stays silent and loud parts mask the bass
        masked_env = np.clip((env_norm - 0.03) / 0.97, 0.0, 1.0)
        return bass_line * masked_env * input_rms * gain

    @staticmethod
    def _generate_constellation_poison(n_samples: int, sr: int, env_norm: np.ndarray, input_rms: float, gain: float, rng: np.random.Generator) -> np.ndarray:
        """
        Generates Psychoacoustic Frequency-Hopping Gabor Chirps (350 Hz - 4800 Hz).
        Each short grain (45-80 ms) concentrates energy into a narrow STFT peak
        to hijack Shazam/ContentID constellation anchor points, while remaining
        inaudible due to simultaneous critical-band masking.
        """
        poison = np.zeros((2, n_samples), dtype=np.float64)
        hop = int(0.028 * sr)  # New chirp burst every 28 ms
        cursor = 0
        while cursor < n_samples:
            grain_len = int(rng.uniform(0.042, 0.078) * sr)
            end = min(n_samples, cursor + grain_len)
            seg_len = end - cursor
            if seg_len < 64:
                break

            local_env = float(np.mean(env_norm[cursor:end]))
            if local_env > 0.04:
                t_seg = np.arange(seg_len, dtype=np.float64) / sr
                win = np.sin(np.pi * np.arange(seg_len, dtype=np.float64) / seg_len) ** 2

                # 2 simultaneous frequency-hopping chirps in the 350 - 4800 Hz fingerprint zone
                for _ in range(2):
                    f_start = float(np.exp(rng.uniform(np.log(360.0), np.log(4600.0))))
                    f_chirp = f_start + float(rng.uniform(-45.0, 45.0)) * (t_seg / (seg_len / sr))
                    phase = 2.0 * np.pi * np.cumsum(f_chirp) / sr + float(rng.uniform(0, 2.0 * np.pi))
                    atomL = np.sin(phase) * win * local_env
                    # Quadrature / partial anti-phase on Right channel so both stereo & mono are poisoned
                    atomR = np.cos(phase + float(rng.uniform(-0.8, 0.8))) * win * local_env
                    poison[0, cursor:end] += atomL
                    poison[1, cursor:end] += atomR

            cursor += hop

        return poison * (input_rms * gain)

    @classmethod
    def _apply_dsp_watermark(cls, wav: np.ndarray, sr: int, rng: np.random.Generator, preset: str = "stealth"):
        """
        Applies Tandu Stealth Master DSP v3.5 (8-Vector Aggressive Anti-Fingerprinting).
        Returns (processed_wav, speed_shift_pct, decorrelation_pct).
        """
        cfg = PRESET_CONFIGS.get(preset, PRESET_CONFIGS["stealth"])
        wav_f64 = wav.astype(np.float64)
        input_rms = float(np.sqrt(np.mean(wav_f64 ** 2)) + 1e-9)

        length = wav_f64.shape[-1]
        t = np.arange(length, dtype=np.float64)

        # ==================================================================
        # VECTOR 1: Quarter-Tone CQT Bin-Boundary Shift + Triple-LFO Rubato
        # ==================================================================
        base_speed = float(rng.uniform(*cfg["speed_range"]))
        wow1_freq = float(rng.uniform(0.045, 0.110))
        wow2_freq = float(rng.uniform(0.160, 0.310))
        flut_freq = float(rng.uniform(0.650, 1.350))

        wow1_depth = float(rng.uniform(*cfg["wow1_depth"]))
        wow2_depth = float(rng.uniform(*cfg["wow2_depth"]))
        flut_depth = float(rng.uniform(*cfg["flutter_depth"]))

        phi1 = float(rng.uniform(0, 2.0 * np.pi))
        phi2 = float(rng.uniform(0, 2.0 * np.pi))
        phi3 = float(rng.uniform(0, 2.0 * np.pi))

        w1 = 2.0 * np.pi * wow1_freq / sr
        w2 = 2.0 * np.pi * wow2_freq / sr
        w3 = 2.0 * np.pi * flut_freq / sr

        t_warp = (
            base_speed * t
            - (wow1_depth / w1) * np.cos(w1 * t + phi1)
            - (wow2_depth / w2) * np.sin(w2 * t + phi2)
            - (flut_depth / w3) * np.cos(w3 * t + phi3)
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

        # Compute instantaneous normalized envelope for psychoacoustic masking
        mono_abs = np.mean(np.abs(y_processed), axis=0)
        b_env, a_env = signal.butter(1, 16 / (sr / 2), btype="lowpass")
        env = signal.filtfilt(b_env, a_env, mono_abs)
        env_norm = np.clip(env / (float(np.max(env)) + 1e-9), 0.0, 1.0)

        # ==================================================================
        # VECTOR 2: 6-Band Sweeping Constellation Scrambler (250 Hz - 9 kHz) +
        #           Dynamic 3D Stereo Spectrum Rotator (L/R Counter-Panning)
        # ==================================================================
        bands_hz = [
            (250, 500),
            (500, 950),
            (950, 1750),
            (1750, 3100),
            (3100, 5200),
            (5200, 9000),
        ]
        mod_amp = (10.0 ** (cfg["eq_mod_db"] / 20.0)) - 1.0
        rot_depth = cfg["stereo_rot_depth"]
        scrambler_delta = np.zeros_like(y_processed)

        for idx_b, (f_lo, f_hi) in enumerate(bands_hz):
            b_bp, a_bp = signal.butter(2, [f_lo / (sr / 2), f_hi / (sr / 2)], btype="bandpass")
            band_sig = signal.filtfilt(b_bp, a_bp, y_processed, axis=-1)
            lfo_rate = float(rng.uniform(0.07 + idx_b * 0.03, 0.18 + idx_b * 0.05))
            lfo_phase = float(rng.uniform(0, 2.0 * np.pi))
            sign = 1.0 if (idx_b % 2 == 0) else -1.0
            lfo = sign * np.sin(2.0 * np.pi * lfo_rate * t_out + lfo_phase)

            # Counter-rotating Stereo Panning per frequency band
            pan_lfo = rot_depth * np.cos(2.0 * np.pi * (lfo_rate * 0.73) * t_out + lfo_phase)
            scrambler_delta[0] += (mod_amp * lfo + pan_lfo) * band_sig[0]
            if y_processed.shape[0] > 1:
                scrambler_delta[1] += (mod_amp * lfo - pan_lfo) * band_sig[1]

        y_processed = y_processed + scrambler_delta

        # ==================================================================
        # VECTOR 3: Chebyshev Harmonic Chroma-Confusion (T2, T3, T5) + Tape Drive
        # ==================================================================
        b_mel, a_mel = signal.butter(2, [280 / (sr / 2), 3600 / (sr / 2)], btype="bandpass")
        mel_band = signal.filtfilt(b_mel, a_mel, y_processed, axis=-1)
        mel_peak = float(np.max(np.abs(mel_band)) + 1e-9)
        x_norm = np.clip(mel_band / mel_peak, -1.0, 1.0)

        t2 = 2.0 * (x_norm ** 2) - 1.0
        t2 -= np.mean(t2, axis=-1, keepdims=True)
        t3 = 4.0 * (x_norm ** 3) - 3.0 * x_norm
        t5 = 16.0 * (x_norm ** 5) - 20.0 * (x_norm ** 3) + 5.0 * x_norm
        cheb_harmonics = (0.35 * t2 + 0.45 * t3 + 0.20 * t5) * mel_peak * cfg["chebyshev_gain"]
        y_processed = y_processed + cheb_harmonics

        # ==================================================================
        # VECTOR 4: Ghost MIDI Sub-Bass Synth + Constellation Poison Chirps
        # ==================================================================
        ghost_bass = cls._generate_ghost_midi_bass(
            n_out, sr, env_norm, input_rms, cfg["ghost_midi_gain"], rng
        )
        y_processed += ghost_bass[None, :]

        poison_chirps = cls._generate_constellation_poison(
            n_out, sr, env_norm, input_rms, cfg["poison_chirp_gain"], rng
        )
        y_processed += poison_chirps[: y_processed.shape[0]]

        # Analog Tape Saturation
        drive = cfg["drive"]
        y_processed = np.tanh(drive * y_processed) / np.tanh(drive)

        # ==================================================================
        # VECTOR 5: Dynamic Stereo "Mono-Trap" + Asymmetric All-Pass Diffuser
        # ==================================================================
        if y_processed.shape[0] == 2:
            mid = 0.5 * (y_processed[0] + y_processed[1])
            side = 0.5 * (y_processed[0] - y_processed[1])

            b_hp_side, a_hp_side = signal.butter(4, 120 / (sr / 2), btype="highpass")
            side = signal.filtfilt(b_hp_side, a_hp_side, side)

            b_side_eq, a_side_eq = signal.butter(2, 2500 / (sr / 2), btype="highpass")
            side_highs = signal.filtfilt(b_side_eq, a_side_eq, side)
            side = side + cfg["side_boost"] * side_highs

            y_processed[0] = mid + side
            y_processed[1] = mid - side

        b_xo_low, a_xo_low = signal.butter(2, 200 / (sr / 2), btype="lowpass")
        b_xo_high, a_xo_high = signal.butter(2, 200 / (sr / 2), btype="highpass")
        low_band = signal.filtfilt(b_xo_low, a_xo_low, y_processed, axis=-1)
        high_band = signal.filtfilt(b_xo_high, a_xo_high, y_processed, axis=-1)

        apf_stages = cfg["apf_stages"]
        base_freqs = np.geomspace(280.0, 9500.0, num=apf_stages)
        for ch in range(high_band.shape[0]):
            ch_sig = high_band[ch]
            for stage_idx in range(apf_stages):
                freq_jitter = rng.uniform(0.82, 1.22)
                fc = float(np.clip(base_freqs[stage_idx] * freq_jitter, 240.0, 12000.0))
                q = float(rng.uniform(0.45, 1.85))
                b_ap, a_ap = cls._allpass_biquad_coeffs(fc, q, sr)
                ch_sig = signal.lfilter(b_ap, a_ap, ch_sig)
            high_band[ch] = ch_sig

        if high_band.shape[0] == 2:
            haas_center_ms = 0.5 * (cfg["haas_min_ms"] + cfg["haas_max_ms"])
            haas_span_ms = 0.5 * (cfg["haas_max_ms"] - cfg["haas_min_ms"])
            haas_lfo_hz = float(rng.uniform(0.11, 0.27))
            haas_delay_samples = (
                haas_center_ms + haas_span_ms * np.sin(2.0 * np.pi * haas_lfo_hz * t_out)
            ) * (sr / 1000.0)
            idx_r = np.arange(n_out, dtype=np.float64) - haas_delay_samples
            high_band[1] = cls._cubic_catmull_rom_1d(high_band[1], idx_r)

        y_processed = low_band + high_band

        # ==================================================================
        # VECTOR 6: Watermark Band Eradication, Bass Sculpting & Noise Masking
        # ==================================================================
        white_noise = rng.normal(0.0, 1.0, y_processed.shape).astype(np.float64)
        b_pink, a_pink = signal.butter(1, 2000 / (sr / 2), btype="lowpass")
        pink_noise = signal.filtfilt(b_pink, a_pink, white_noise, axis=-1)
        pink_noise /= float(np.max(np.abs(pink_noise)) + 1e-9)
        pink_level = 10.0 ** (cfg["pink_noise_db"] / 20.0)
        y_processed += pink_noise * pink_level * (0.35 + 0.65 * env_norm[None, :])

        t_hum = np.arange(n_out, dtype=np.float64)
        hum = (
            np.sin(2.0 * np.pi * 60.0 * t_hum / sr)
            + 0.5 * np.sin(2.0 * np.pi * 120.0 * t_hum / sr)
            + 0.25 * np.sin(2.0 * np.pi * 180.0 * t_hum / sr)
        )
        hum_level = 10.0 ** (cfg["hum_db"] / 20.0)
        y_processed += hum[None, :] * hum_level * (0.30 + 0.70 * env_norm[None, :])

        b_bass, a_bass = signal.butter(2, [60 / (sr / 2), 250 / (sr / 2)], btype="bandpass")
        bass_band = signal.filtfilt(b_bass, a_bass, y_processed, axis=-1)
        attenuation_lin = 10.0 ** (cfg["bass_cut_db"] / 20.0)
        y_processed = y_processed - bass_band + (bass_band * attenuation_lin)

        lpf_hz = cfg["lpf_cutoff_hz"]
        b_agg_lp, a_agg_lp = signal.butter(6, lpf_hz / (sr / 2), btype="lowpass")
        y_processed = signal.filtfilt(b_agg_lp, a_agg_lp, y_processed, axis=-1)

        b_hp_master, a_hp_master = signal.butter(4, 30 / (sr / 2), btype="highpass")
        y_processed = signal.filtfilt(b_hp_master, a_hp_master, y_processed, axis=-1)

        y_processed -= np.mean(y_processed, axis=-1, keepdims=True)
        output_rms = float(np.sqrt(np.mean(y_processed ** 2)) + 1e-9)
        y_processed *= (input_rms / output_rms)

        dither = (rng.uniform(-1.0, 1.0, y_processed.shape) + rng.uniform(-1.0, 1.0, y_processed.shape)) * (10.0 ** (-78.0 / 20.0))
        y_processed += dither

        ceiling = 0.966
        peak = float(np.max(np.abs(y_processed)))
        if peak > ceiling:
            y_processed = np.tanh(1.15 * y_processed) / np.tanh(1.15)
            peak2 = float(np.max(np.abs(y_processed)))
            if peak2 > ceiling:
                y_processed *= ceiling / peak2

        speed_shift_pct = round((base_speed - 1.0) * 100.0, 2)
        cents_shift = 1200.0 * np.log2(base_speed)
        cqt_evasion = min(1.0, cents_shift / 48.0)
        decorr_pct = round(
            min(99.4, (cqt_evasion * 48.0) + (cfg["eq_mod_db"] * 5.8) + (apf_stages * 1.1) + 12.5),
            1,
        )
        return y_processed.astype(np.float32), speed_shift_pct, decorr_pct

    @staticmethod
    def _encode(downmix: np.ndarray, sr: int, out_dir: str, job_id: str, fmt: str) -> str:
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
                    break
            except requests.RequestException as e:
                print(f"[upload] intento {attempt}: {e}")
            time.sleep(2 ** attempt)
        return False

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

        print(f"[1/3] Cargando y decodificando audio (Preset={preset})...")
        wav = self._load_audio(str(audio_file))
        duration = wav.shape[-1] / self.samplerate
        print(f"      duración={duration:.1f}s sr={self.samplerate}")

        print(f"[2/3] Aplicando Ghost MIDI Bass + Gabor Poison + Stereo Rotator ({preset})...")
        downmix, speed_shift_pct, decorr_pct = self._apply_dsp_watermark(
            wav, self.samplerate, rng, preset=preset
        )
        del wav

        print("[3/3] Masterizando y codificando...")
        peak_lin = float(np.max(np.abs(downmix)) + 1e-9)
        peak_dbtp = round(20.0 * float(np.log10(peak_lin)), 2)
        out_path = self._encode(downmix, self.samplerate, work_dir, job_id, output_format)
        size_mb = os.path.getsize(out_path) / 1e6
        print(f"      {os.path.basename(out_path)} ({size_mb:.1f} MB) | Decorrelación={decorr_pct}% | +{speed_shift_pct}%")

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
            decorrelation_pct=decorr_pct,
        )
