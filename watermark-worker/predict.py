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
        Applies Varispeed and Cascaded All-Pass Filters to decorrelate the master track.
        """
        # 1. Varispeed (0.8% to 1.5% speed/pitch up)
        speed_factor = rng.uniform(1.008, 1.015)
        
        # Resample to apply varispeed (changes speed while preserving phase perfect)
        y_processed = librosa.resample(wav, orig_sr=sr * speed_factor, target_sr=sr, axis=-1)
        
        # 2. Cascaded All-Pass Filters to alter global phase imperceptibly
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
            
        return y_processed

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
