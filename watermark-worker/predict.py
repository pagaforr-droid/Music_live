"""
Tandu DSP Watermark Worker (Replicate / Cog)

Pipeline:
  1. Load any audio format (ffmpeg via demucs.audio.AudioFile) and resample
     to the model's native sample rate (44.1 kHz) and channel count (stereo).
  2. Deconstruct with HTDemucs into drums / bass / other / vocals.
  3. Apply stem-specific DSP decorrelation (micro pitch-shift + phase rotation
     on harmonic stems, sub-millisecond phase delay on drums). Random
     parameters are drawn ONCE per stem and applied identically to both
     channels so the stereo image is preserved.
  4. Reconstruct the downmix, peak-limit, encode (wav / flac / mp3).
  5. Optionally PUT the result to a Supabase signed upload URL.
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
from cog import BaseModel, BasePredictor, Input, Path
from demucs.apply import apply_model
from demucs.audio import AudioFile
from demucs.pretrained import get_model

TMP_PREFIX = "tandu_wm_"
N_FFT = 2048
HOP = 512

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
        """Load HTDemucs once per container (weights are pre-cached at build time)."""
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[setup] Using device: {self.device}")
        self.model = get_model("htdemucs")
        self.model.to(self.device)
        self.model.eval()
        self.samplerate = int(self.model.samplerate)
        self.channels = int(self.model.audio_channels)
        self.sources = list(self.model.sources)  # e.g. ['drums','bass','other','vocals']
        print(f"[setup] Model ready. sr={self.samplerate} ch={self.channels} sources={self.sources}")

    # ------------------------------------------------------------------ utils

    @staticmethod
    def _cleanup_previous_runs():
        """Outputs must survive until Cog uploads them, so we clean the
        previous predictions' folders at the start of the next one."""
        for d in glob.glob(os.path.join(tempfile.gettempdir(), f"{TMP_PREFIX}*")):
            shutil.rmtree(d, ignore_errors=True)

    def _load_audio(self, path: str) -> torch.Tensor:
        """Returns a float tensor (channels, time) at the model sample rate."""
        wav = AudioFile(path).read(
            streams=0, samplerate=self.samplerate, channels=self.channels
        )
        if wav.dim() != 2 or wav.shape[-1] == 0:
            raise ValueError("El archivo de audio está vacío o no se pudo decodificar.")
        return wav.float()

    def _separate(self, wav: torch.Tensor) -> dict:
        """HTDemucs separation. wav: (channels, time). Returns {name: np.ndarray (ch, time)}."""
        ref = wav.mean(0)  # mono reference, (time,)
        mean, std = ref.mean(), ref.std()
        if std < 1e-8:
            raise ValueError("El audio es silencio digital; no hay nada que procesar.")
        normed = (wav - mean) / std

        with torch.no_grad():
            sources = apply_model(
                self.model,
                normed[None].to(self.device),
                shifts=1,
                split=True,
                overlap=0.25,
                progress=False,
            )[0]
        sources = (sources * std + mean).cpu().numpy().astype(np.float32)
        return {name: sources[i] for i, name in enumerate(self.sources)}

    @staticmethod
    def _process_stem(y: np.ndarray, sr: int, name: str, rng: np.random.Generator) -> np.ndarray:
        """y: (channels, time). Same random params for every channel."""
        length = y.shape[-1]

        if name in ("vocals", "other", "bass"):
            shift_cents = rng.uniform(2.0, 4.0)
            phase_offset = np.exp(1j * rng.uniform(0.1, 0.5)).astype(np.complex64)
            y_ps = librosa.effects.pitch_shift(y, sr=sr, n_steps=shift_cents / 100.0)
            D = librosa.stft(y_ps, n_fft=N_FFT, hop_length=HOP)
            out = librosa.istft(D * phase_offset, hop_length=HOP, length=length)

        elif name == "drums":
            delay_s = rng.uniform(0.0005, 0.0012)  # 0.5–1.2 ms, below flam threshold
            freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
            rot = np.exp(-1j * 2 * np.pi * freqs * delay_s).astype(np.complex64)[:, None]
            D = librosa.stft(y, n_fft=N_FFT, hop_length=HOP)
            out = librosa.istft(D * rot, hop_length=HOP, length=length)

        else:
            out = y

        out = np.asarray(out, dtype=np.float32)
        if out.shape[-1] < length:
            out = np.pad(out, [(0, 0)] * (out.ndim - 1) + [(0, length - out.shape[-1])])
        return out[..., :length]

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
        upload_url: Optional[str] = Input(
            description="URL firmada de subida de Supabase Storage (opcional)", default=None
        ),
        output_format: str = Input(
            description="Formato de salida", choices=["wav", "flac", "mp3"], default="wav"
        ),
        seed: Optional[int] = Input(description="Semilla para reproducibilidad (opcional)", default=None),
    ) -> Output:
        self._cleanup_previous_runs()
        work_dir = tempfile.mkdtemp(prefix=TMP_PREFIX)
        rng = np.random.default_rng(seed)
        t0 = time.time()

        print("[1/5] Cargando y remuestreando audio...")
        wav = self._load_audio(str(audio_file))
        duration = wav.shape[-1] / self.samplerate
        print(f"      duración={duration:.1f}s sr={self.samplerate}")

        print("[2/5] Separando stems con HTDemucs...")
        stems = self._separate(wav)
        del wav
        if self.device == "cuda":
            torch.cuda.empty_cache()

        print("[3/5] Aplicando decorrelación DSP...")
        downmix = None
        for name, stem in stems.items():
            processed = self._process_stem(stem, self.samplerate, name, rng)
            downmix = processed if downmix is None else downmix + processed
        del stems

        print("[4/5] Reconstruyendo y codificando...")
        downmix -= downmix.mean(axis=-1, keepdims=True)  # remove DC
        peak = float(np.max(np.abs(downmix)))
        if peak > 0.99:
            downmix *= 0.99 / peak
        out_path = self._encode(downmix, self.samplerate, work_dir, job_id, output_format)
        size_mb = os.path.getsize(out_path) / 1e6
        print(f"      {os.path.basename(out_path)} ({size_mb:.1f} MB)")

        uploaded = False
        if upload_url:
            print("[5/5] Subiendo a Supabase Storage...")
            uploaded = self._upload(out_path, upload_url, CONTENT_TYPES[output_format])
            print("      OK" if uploaded else "      FALLÓ: el cliente usará la salida de Replicate")
        else:
            print("[5/5] Sin upload_url: la salida queda en Replicate.")

        print(f"Listo en {time.time() - t0:.1f}s")
        return Output(
            file=Path(out_path),
            uploaded=uploaded,
            format=output_format,
            sample_rate=self.samplerate,
            duration_seconds=round(duration, 2),
        )
