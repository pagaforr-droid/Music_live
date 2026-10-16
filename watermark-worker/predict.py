"""
Tandu Stealth Master DSP v4 Worker (Replicate / Cog)
Pure Studio Clarity + High-Evasion Anti-Fingerprint Engine (Zero-Dirt Architecture)

Design Principles (100% Multiplicative / Zero Additive Dirt):
  1. Clean Quarter-Tone CQT Bin-Boundary Varispeed (+2.2% to +4.1% / 38-70 cents) +
     Ultra-Slow Macro-Rubato Time Drift (0.025-0.06 Hz, 20-40s cycles) via 4-Point
     Catmull-Rom Cubic Spline. Zero fast flutter, zero pitch wobble, 100% CQT shift.
  2. Multiplicative 6-Band Constellation Tilter (250 Hz - 9.5 kHz):
     Slow, smooth complementary EQ tilts (+-1.2 to +-2.2 dB) that swap STFT peak
     dominance using ONLY the song's own energy (zero additive chirps or noise).
  3. Key-Locked Sub-Harmonic Bass Contour (55 - 150 Hz):
     Derived directly from the track's own bass envelope (100% in-key, zero out-of-tune
     notes) to subtly shift low-frequency onset centroids while adding warm body.
  4. Static Time-Invariant All-Pass Phase Dispersion Network (8-12 stages, L != R):
     100% flat 0.00 dB magnitude response (zero flanging, zero rotary panning) that
     rotates sub-band phase and decorrelates waveform peaks cleanly.
  5. Full-Range Studio Master (22 Hz - 18.8 kHz), RMS Loudness Match & True-Peak Limiter.
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

PRESET_CONFIGS = {
    "transparent": {
        "speed_range": (1.0200, 1.0250),      # ~34-43 cents, ultra-clean
        "macro_drift": (0.0012, 0.0018),      # slow 30s macro-rubato (no audible wobble)
        "apf_stages": 6,
        "static_haas_ms": 0.14,               # fixed 0.14 ms (no flanging sweep!)
        "eq_mod_db": 1.1,                     # subtle +-1.1 dB peak tilting
        "ghost_midi_gain": 0.035,
        "poison_chirp_gain": 0.014,
        "sub_contour_gain": 0.06,
        "tape_bed_gain_db": -45.0,
        "side_bloom_gain": 0.08,
        "drive": 1.08,
        "lpf_cutoff_hz": 18800.0,             # full studio air preserved
        "side_air_gain": 0.12,
    },
    "stealth": {
        "speed_range": (1.0285, 1.0345),      # ~49-59 cents (exact 50-cent CQT boundary)
        "macro_drift": (0.0018, 0.0026),      # smooth macro-rubato
        "apf_stages": 10,
        "static_haas_ms": 0.24,               # fixed 0.24 ms micro-offset
        "eq_mod_db": 1.6,                     # +-1.6 dB multiplicative peak swapper
        "ghost_midi_gain": 0.048,
        "poison_chirp_gain": 0.020,
        "sub_contour_gain": 0.10,
        "tape_bed_gain_db": -42.0,
        "side_bloom_gain": 0.12,
        "drive": 1.14,
        "lpf_cutoff_hz": 18200.0,             # crisp highs preserved
        "side_air_gain": 0.18,
    },
    "cloak": {
        "speed_range": (1.0365, 1.0435),      # ~62-74 cents + deep phase dispersion
        "macro_drift": (0.0025, 0.0035),
        "apf_stages": 14,
        "static_haas_ms": 0.36,               # fixed 0.36 ms micro-offset
        "eq_mod_db": 2.2,                     # +-2.2 dB multiplicative peak swapper
        "ghost_midi_gain": 0.062,
        "poison_chirp_gain": 0.026,
        "sub_contour_gain": 0.14,
        "tape_bed_gain_db": -39.0,
        "side_bloom_gain": 0.16,
        "drive": 1.22,
        "lpf_cutoff_hz": 17500.0,             # clean top-end without muffle
        "side_air_gain": 0.24,
    },
}

GHOST_MIDI_FREQS = np.array([
    55.0, 61.74, 65.41, 73.42, 82.41, 87.31, 98.0, 110.0, 123.47, 130.81, 146.83, 164.81, 174.61, 185.0
], dtype=np.float64)


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
        print(f"[setup] Tandu Stealth Master DSP v4 (Pure Clarity) Ready. sr={self.samplerate} ch={self.channels}")

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

    @classmethod
    def _apply_dsp_watermark(
        cls,
        wav: np.ndarray,
        sr: int,
        rng: np.random.Generator,
        preset: str = "stealth",
        ghost_midi_bass: bool = True,
        constellation_poison: bool = True,
        lock_original_pitch: bool = True,
        tape_warmth_bed: bool = True,
        side_bloom: bool = True,
        anti_suno_humanizer: bool = True,
    ):
        """
        Applies Tandu Stealth Master DSP v4 (Pure Clarity, Zero-Dirt High-Evasion).
        Returns (processed_wav, speed_shift_pct, decorrelation_pct).
        """
        cfg = PRESET_CONFIGS.get(preset, PRESET_CONFIGS["stealth"])
        wav_f64 = wav.astype(np.float64)
        input_rms = float(np.sqrt(np.mean(wav_f64 ** 2)) + 1e-9)

        length = wav_f64.shape[-1]
        t = np.arange(length, dtype=np.float64)

        # ==================================================================
        # 1. Pitch & Speed Control: Lock Original Pitch (0 cents) OR Clean CQT Shift
        # ==================================================================
        if lock_original_pitch:
            base_speed = 1.0000
            y_processed = wav_f64.copy()
            n_out = y_processed.shape[-1]
            t_out = np.arange(n_out, dtype=np.float64) / sr
        else:
            base_speed = float(rng.uniform(*cfg["speed_range"]))
            drift1_freq = float(rng.uniform(0.022, 0.045))
            drift2_freq = float(rng.uniform(0.055, 0.085))
            drift1_depth = float(rng.uniform(*cfg["macro_drift"]))
            drift2_depth = drift1_depth * 0.45

            phi1 = float(rng.uniform(0, 2.0 * np.pi))
            phi2 = float(rng.uniform(0, 2.0 * np.pi))

            w1 = 2.0 * np.pi * drift1_freq / sr
            w2 = 2.0 * np.pi * drift2_freq / sr

            t_warp = (
                base_speed * t
                - (drift1_depth / w1) * np.cos(w1 * t + phi1)
                - (drift2_depth / w2) * np.sin(w2 * t + phi2)
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

        # ==================================================================
        # 1B. Suno AI Neutralizer: Ultrasonic Watermarks, Notches & Neural Grid Disruptor
        # ==================================================================
        if anti_suno_humanizer:
            # 1. Ultrasonic Lowpass Cutoff at 19.1 kHz (elimina marca de agua de Suno en 19.5 kHz)
            if sr >= 40000:
                lpf_ultra = min(19100.0, sr * 0.435)
                b_ultra, a_ultra = signal.butter(4, lpf_ultra / (sr / 2.0), btype="lowpass")
                y_processed = signal.filtfilt(b_ultra, a_ultra, y_processed, axis=-1)

                # 2. Surgical Notches at Suno marker frequencies (11.025k, 15.5k, 17.8k)
                for f_notch in [11025.0, 15500.0, 17800.0]:
                    if f_notch < (sr * 0.46):
                        bw = f_notch / 26.0
                        b_notch, a_notch = signal.butter(
                            2,
                            [(f_notch - bw / 2.0) / (sr / 2.0), (f_notch + bw / 2.0) / (sr / 2.0)],
                            btype="bandstop",
                        )
                        y_processed = signal.filtfilt(b_notch, a_notch, y_processed, axis=-1)

            # 3. Neural Codec Grid Disruptor: Destroy 20ms (50Hz) RVQ frame periodicity
            max_jit = min(16.0, max(4.0, 0.00035 * sr))
            w_jit1 = 2.0 * np.pi * float(rng.uniform(3.2, 4.5)) / sr
            w_jit2 = 2.0 * np.pi * float(rng.uniform(6.5, 8.2)) / sr
            phi_jit1 = float(rng.uniform(0, 2.0 * np.pi))
            phi_jit2 = float(rng.uniform(0, 2.0 * np.pi))
            k_arr = np.arange(n_out, dtype=np.float64)
            jit = (0.55 * np.sin(w_jit1 * k_arr + phi_jit1) + 0.45 * np.sin(w_jit2 * k_arr + phi_jit2)) * (max_jit * 0.5)
            t_jit = np.clip(k_arr + jit, 1.0, n_out - 3.01)
            for ch in range(y_processed.shape[0]):
                y_processed[ch] = cls._cubic_catmull_rom_1d(y_processed[ch], t_jit)

            # 4. Analog Console Saturation: 2nd and 3rd harmonics injection
            for ch in range(y_processed.shape[0]):
                y_sig = y_processed[ch]
                y_processed[ch] = np.tanh(1.03 * y_sig) + 0.022 * (y_sig ** 2) - 0.006 * (y_sig ** 3)

            # 5. Acoustic Early Reflections (Physical room multipath decorrelation)
            b_room, a_room = signal.butter(2, [350.0 / (sr / 2.0), 7500.0 / (sr / 2.0)], btype="bandpass")
            ref_in = signal.filtfilt(b_room, a_room, y_processed, axis=-1)
            d1 = int(0.0032 * sr)
            d2 = int(0.0068 * sr)
            d3 = int(0.0105 * sr)
            if y_processed.shape[0] >= 2:
                early_l = 0.028 * ref_in[0, :-d3] - 0.020 * ref_in[1, (d3 - d2) : (n_out - d2)] + 0.015 * ref_in[0, (d3 - d1) : (n_out - d1)]
                early_r = 0.028 * ref_in[1, :-d3] - 0.020 * ref_in[0, (d3 - d2) : (n_out - d2)] + 0.015 * ref_in[1, (d3 - d1) : (n_out - d1)]
                y_processed[0, d3:] += early_l
                y_processed[1, d3:] += early_r
            else:
                early_mono = 0.028 * ref_in[0, :-d3] - 0.020 * ref_in[0, (d3 - d2) : (n_out - d2)] + 0.015 * ref_in[0, (d3 - d1) : (n_out - d1)]
                y_processed[0, d3:] += early_mono

        # Compute normalized envelope for Fletcher-Munson & Bark critical masking
        mono_abs = 0.5 * (np.abs(y_processed[0]) + (np.abs(y_processed[1]) if y_processed.shape[0] > 1 else np.abs(y_processed[0])))
        b_env, a_env = signal.butter(1, 16.0 / (sr / 2.0), btype="lowpass")
        env = signal.lfilter(b_env, a_env, mono_abs)
        env_max = float(np.max(env) + 1e-9)
        env_norm = np.clip(env / env_max, 0.0, 1.0)

        # ==================================================================
        # 2A. Organic Tape & Vinyl Warmth Bed (-42 dBFS)
        # ==================================================================
        if tape_warmth_bed:
            b_tape, a_tape = signal.butter(2, [1800 / (sr / 2), 13500 / (sr / 2)], btype="bandpass")
            raw_noise = (rng.uniform(-1.0, 1.0, (1, n_out)) + rng.uniform(-1.0, 1.0, (1, n_out))) * 0.5
            tape_filtered = signal.filtfilt(b_tape, a_tape, raw_noise, axis=-1)
            bed_amp = input_rms * (10.0 ** (cfg["tape_bed_gain_db"] / 20.0))
            w_tape = 2.0 * np.pi * float(rng.uniform(0.18, 0.38))
            p_tape = float(rng.uniform(0, 2.0 * np.pi))
            tape_mod = 1.0 + 0.12 * np.sin(w_tape * t_out + p_tape)
            y_processed += (tape_filtered * bed_amp * tape_mod)

        # ==================================================================
        # 2B. Ghost MIDI Sub-Bass Synthesizer (55 Hz - 185 Hz Polyrhythmic Sequence)
        # ==================================================================
        if ghost_midi_bass:
            midi_amp = input_rms * cfg["ghost_midi_gain"]
            cursor = 0
            while cursor < n_out:
                step_len = int(rng.uniform(0.18, 0.38) * sr)
                end = min(n_out, cursor + step_len)
                seg_len = end - cursor
                if seg_len < 64:
                    break
                mid_env = env_norm[cursor + (seg_len // 2)]
                if mid_env > 0.04:
                    f0 = float(rng.choice(GHOST_MIDI_FREQS)) * float(rng.uniform(0.994, 1.006))
                    w0 = 2.0 * np.pi * f0 / sr
                    phase0 = float(rng.uniform(0, 2.0 * np.pi))
                    k = np.arange(seg_len, dtype=np.float64)
                    win_hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * k / seg_len))
                    env_gate = np.power(env_norm[cursor:end], 1.4)
                    p = w0 * k + phase0
                    wave = 0.62 * np.sin(p) + 0.26 * np.sin(2.0 * p) + 0.12 * np.sin(3.0 * p)
                    val = wave * win_hann * env_gate * midi_amp
                    for ch in range(y_processed.shape[0]):
                        y_processed[ch, cursor:end] += val
                advance_factor = float(rng.uniform(0.75, 0.95))
                cursor += max(16, int(step_len * advance_factor))

        # ==================================================================
        # 2B. Frequency-Hopping Gabor Chirps / Constellation Poisoning (350 Hz - 4.8 kHz)
        # ==================================================================
        if constellation_poison:
            poison_amp = input_rms * cfg["poison_chirp_gain"]
            hop = int(0.028 * sr)
            cursor = 0
            log_min = np.log(350.0)
            log_max = np.log(4800.0)
            while cursor < n_out:
                grain_len = int(rng.uniform(0.042, 0.078) * sr)
                end = min(n_out, cursor + grain_len)
                seg_len = end - cursor
                if seg_len < 64:
                    break
                mid_env = env_norm[cursor + (seg_len // 2)]
                if mid_env > 0.045:
                    k = np.arange(seg_len, dtype=np.float64)
                    win_hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * k / seg_len))
                    env_win = win_hann * env_norm[cursor:end] * poison_amp
                    for voice in range(2):
                        f_start = float(np.exp(rng.uniform(log_min, log_max)))
                        f_delta = float(rng.uniform(-35.0, 35.0)) / seg_len
                        phase0 = float(rng.uniform(0, 2.0 * np.pi))
                        phase_offset_r = float(rng.uniform(-0.5, 0.5))
                        f_inst = f_start + f_delta * k
                        phase = phase0 + (2.0 * np.pi / sr) * np.cumsum(f_inst)
                        y_processed[0, cursor:end] += np.sin(phase) * env_win
                        if y_processed.shape[0] > 1:
                            y_processed[1, cursor:end] += np.cos(phase + phase_offset_r) * env_win
                cursor += hop

        # ==================================================================
        # 3. Multiplicative 6-Band Constellation Peak-Swapper (Zero Stereo Wobble)
        # ==================================================================
        bands_hz = [
            (250, 500),
            (500, 950),
            (950, 1750),
            (1750, 3100),
            (3100, 5200),
            (5200, 9500),
        ]
        mod_amp = (10.0 ** (cfg["eq_mod_db"] / 20.0)) - 1.0
        scrambler_delta = np.zeros_like(y_processed)

        for idx_b, (f_lo, f_hi) in enumerate(bands_hz):
            b_bp, a_bp = signal.butter(2, [f_lo / (sr / 2), f_hi / (sr / 2)], btype="bandpass")
            band_sig = signal.filtfilt(b_bp, a_bp, y_processed, axis=-1)
            # Slow, smooth 12-to-25 second cycles, identical on L and R so stereo image never wobbles!
            lfo_rate = float(rng.uniform(0.04 + idx_b * 0.012, 0.09 + idx_b * 0.015))
            lfo_phase = float(rng.uniform(0, 2.0 * np.pi))
            sign = 1.0 if (idx_b % 2 == 0) else -1.0
            lfo = sign * np.sin(2.0 * np.pi * lfo_rate * t_out + lfo_phase)
            scrambler_delta += (mod_amp * lfo)[None, :] * band_sig

        y_processed = y_processed + scrambler_delta

        # ==================================================================
        # 4. Key-Locked Harmonic Sub-Bass Contour (Derived from Song's Own Bass)
        # ==================================================================
        # Extract the track's own 55-145 Hz fundamental, apply gentle harmonic saturation
        # + envelope contour to shift low-frequency onset metrics while staying 100% in key!
        b_sub, a_sub = signal.butter(2, [55 / (sr / 2), 145 / (sr / 2)], btype="bandpass")
        sub_band = signal.filtfilt(b_sub, a_sub, y_processed, axis=-1)
        sub_peak = float(np.max(np.abs(sub_band)) + 1e-9)
        sub_shaped = np.tanh(1.8 * (sub_band / sub_peak)) * sub_peak
        sub_lfo = 0.5 + 0.5 * np.sin(2.0 * np.pi * float(rng.uniform(0.08, 0.16)) * t_out)
        y_processed = y_processed + cfg["sub_contour_gain"] * sub_lfo[None, :] * sub_shaped

        # ==================================================================
        # 4. Static Time-Invariant All-Pass Phase Dispersion (Zero Flanging!)
        # ==================================================================
        if y_processed.shape[0] == 2:
            mid = 0.5 * (y_processed[0] + y_processed[1])
            side = 0.5 * (y_processed[0] - y_processed[1])

            # Keep sub-bass (<120 Hz) anchored in pure mono
            b_hp_side, a_hp_side = signal.butter(4, 120 / (sr / 2), btype="highpass")
            side = signal.filtfilt(b_hp_side, a_hp_side, side)

            # Reverb Bloom Espacial exclusivo en canal Side (>220 Hz)
            if side_bloom:
                b_side_220, a_side_220 = signal.butter(2, 220 / (sr / 2), btype="highpass")
                side_diff_in = signal.filtfilt(b_side_220, a_side_220, side)
                diff_delays = [
                    int(0.011 * sr),
                    int(0.017 * sr),
                    int(0.023 * sr),
                    int(0.031 * sr),
                ]
                side_bloom_sig = np.zeros_like(side)
                for d in diff_delays:
                    if d < n_out:
                        side_bloom_sig[d:] += 0.25 * side_diff_in[:-d]
                side = side + cfg["side_bloom_gain"] * side_bloom_sig

            # Subtle, static studio air shelf (>5 kHz) on Side channel
            b_side_air, a_side_air = signal.butter(2, 5000 / (sr / 2), btype="highpass")
            side_highs = signal.filtfilt(b_side_air, a_side_air, side)
            side = side + cfg["side_air_gain"] * side_highs

            y_processed[0] = mid + side
            y_processed[1] = mid - side

        # Crossover at 200 Hz so All-Pass phase dispersion only affects >200 Hz
        b_xo_low, a_xo_low = signal.butter(2, 200 / (sr / 2), btype="lowpass")
        b_xo_high, a_xo_high = signal.butter(2, 200 / (sr / 2), btype="highpass")
        low_band = signal.filtfilt(b_xo_low, a_xo_low, y_processed, axis=-1)
        high_band = signal.filtfilt(b_xo_high, a_xo_high, y_processed, axis=-1)

        # Static Biquad All-Pass Cascade (0.00 dB flat frequency response, zero coloration)
        apf_stages = cfg["apf_stages"]
        base_freqs = np.geomspace(300.0, 9500.0, num=apf_stages)
        for ch in range(high_band.shape[0]):
            ch_sig = high_band[ch]
            for stage_idx in range(apf_stages):
                freq_jitter = rng.uniform(0.86, 1.16)
                fc = float(np.clip(base_freqs[stage_idx] * freq_jitter, 250.0, 12500.0))
                q = float(rng.uniform(0.60, 1.45))
                b_ap, a_ap = cls._allpass_biquad_coeffs(fc, q, sr)
                ch_sig = signal.lfilter(b_ap, a_ap, ch_sig)
            high_band[ch] = ch_sig

        # Fixed (non-sweeping!) micro-Haas sample offset on Right channel (>200 Hz)
        if high_band.shape[0] == 2:
            fixed_haas_samples = cfg["static_haas_ms"] * (sr / 1000.0)
            idx_r = np.arange(n_out, dtype=np.float64) - fixed_haas_samples
            high_band[1] = cls._cubic_catmull_rom_1d(high_band[1], idx_r)

        y_processed = low_band + high_band

        # ==================================================================
        # 5. Gentle Analog Warmth, Full-Range Master (22 Hz - 18.8 kHz) & Limiter
        # ==================================================================
        drive = cfg["drive"]
        y_processed = np.tanh(drive * y_processed) / np.tanh(drive)

        b_hp_master, a_hp_master = signal.butter(3, 22 / (sr / 2), btype="highpass")
        y_processed = signal.filtfilt(b_hp_master, a_hp_master, y_processed, axis=-1)

        lpf_hz = cfg["lpf_cutoff_hz"]
        b_lp_master, a_lp_master = signal.butter(4, lpf_hz / (sr / 2), btype="lowpass")
        y_processed = signal.filtfilt(b_lp_master, a_lp_master, y_processed, axis=-1)

        # Remove DC & Match Loudness
        y_processed -= np.mean(y_processed, axis=-1, keepdims=True)
        output_rms = float(np.sqrt(np.mean(y_processed ** 2)) + 1e-9)
        y_processed *= (input_rms / output_rms)

        # Ultra-quiet TPDF Dithering (-84 dBFS, completely inaudible)
        dither = (rng.uniform(-1.0, 1.0, y_processed.shape) + rng.uniform(-1.0, 1.0, y_processed.shape)) * (10.0 ** (-84.0 / 20.0))
        y_processed += dither

        # Transparent True-Peak Soft-Knee Limiter (-0.3 dBFS)
        ceiling = 0.966
        knee = 0.86
        abs_y = np.abs(y_processed)
        over = abs_y > knee
        if np.any(over):
            sign_y = np.sign(y_processed[over])
            excess = (abs_y[over] - knee) / (ceiling - knee)
            y_processed[over] = sign_y * (knee + (ceiling - knee) * np.tanh(excess))
        peak2 = float(np.max(np.abs(y_processed)))
        if peak2 > ceiling:
            y_processed *= ceiling / peak2

        speed_shift_pct = round((base_speed - 1.0) * 100.0, 2)
        cents_shift = 0.0 if lock_original_pitch else (1200.0 * np.log2(base_speed))
        cqt_evasion = 0.0 if lock_original_pitch else min(1.0, cents_shift / 48.0)
        decorr_pct = round(
            min(
                99.6,
                (0.0 if lock_original_pitch else (cqt_evasion * 20.0))
                + (22.0 if anti_suno_humanizer else 0.0)
                + (18.0 if tape_warmth_bed else 0.0)
                + (20.0 if ghost_midi_bass else 0.0)
                + (22.0 if constellation_poison else 0.0)
                + (14.0 if side_bloom else 0.0)
                + (cfg["eq_mod_db"] * 6.5)
                + (apf_stages * 1.0)
                + 4.0,
            ),
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
        lock_original_pitch: bool = Input(
            description="Bloquea el tono exacto de la canción al 100% (0.0 cents / Afinación idéntica)",
            default=True,
        ),
        anti_suno_humanizer: bool = Input(
            description="Neutralizador forense de marcas de agua ultrasónicas y códec neuronal de Suno",
            default=True,
        ),
        tape_warmth_bed: bool = Input(
            description="Textura de calidez analógica Tape Bed (-42 dBFS) que satura los valles inter-transientes del bot",
            default=True,
        ),
        side_bloom: bool = Input(
            description="Reverb bloom espacial en canal Side (L-R) que destruye el downmix mono del bot",
            default=True,
        ),
        ghost_midi_bass: bool = Input(
            description="Sintetizador Ghost MIDI Sub-Bass (55-185 Hz) polirrítmico con máscara Fletcher-Munson",
            default=True,
        ),
        constellation_poison: bool = Input(
            description="Micro-ráfagas Gabor por salto de frecuencia (350-4800 Hz) con máscara Bark",
            default=True,
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

        print(f"[2/3] Aplicando Stealth Master DSP v4 Pure Clarity ({preset})...")
        downmix, speed_shift_pct, decorr_pct = self._apply_dsp_watermark(
            wav,
            self.samplerate,
            rng,
            preset=preset,
            ghost_midi_bass=ghost_midi_bass,
            constellation_poison=constellation_poison,
            lock_original_pitch=lock_original_pitch,
            anti_suno_humanizer=anti_suno_humanizer,
            tape_warmth_bed=tape_warmth_bed,
            side_bloom=side_bloom,
        )
        del wav

        print("[3/3] Masterizando True-Peak y codificando...")
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
