"""Small model boundary: faster-whisper ASR and independently maintained CTC alignment.

Heavy imports stay inside calls so model-free tests and the worker protocol stay cheap.
"""
import subprocess
import ctypes
import os
import site
from pathlib import Path

SAMPLE_RATE = 16000
_dll_handles = []


def prepare_cuda_libraries():
    """CTranslate2 needs CUDA 12 even when Torch uses CUDA 13; keep their DLLs separate."""
    for base in site.getsitepackages():
        for package in ("cuda_runtime", "cuda_nvrtc", "cublas", "cudnn"):
            root = Path(base) / "nvidia" / package
            if os.name == "nt":
                directory = root / "bin"
                if directory.is_dir():
                    _dll_handles.append(os.add_dll_directory(str(directory)))
                    os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")
            else:
                for name in ("libcudart.so.12", "libcublasLt.so.12", "libcublas.so.12", "libcudnn.so.9"):
                    path = root / "lib" / name
                    if path.is_file():
                        _dll_handles.append(ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL))


def load_audio(path: str):
    import numpy as np
    output = subprocess.run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", path,
        "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
    ], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(output, np.int16).astype(np.float32) / 32768.0


def interpolate_nans(values, method="nearest"):
    if method == "ignore":
        return values
    if values.notnull().sum() > 1:
        return values.interpolate(method=method).ffill().bfill()
    return values.ffill().bfill()


class Asr:
    def __init__(self, model):
        self.model = model

    def transcribe(self, audio, language):
        # Decode through our ffmpeg boundary; PyAV API changes must not affect ASR input.
        waveform = load_audio(audio) if isinstance(audio, str) else audio
        segments, _ = self.model.transcribe(waveform, language=language, beam_size=5,
                                            vad_filter=True, condition_on_previous_text=False)
        return {"segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments]}


def load_model(name, device, compute_type, language):
    if device == "cuda":
        prepare_cuda_libraries()
    from faster_whisper import BatchedInferencePipeline, WhisperModel
    return Asr(BatchedInferencePipeline(WhisperModel(name, device=device, compute_type=compute_type)))


def load_align_model(language_code, device):
    from .thirdParty.alignment import load_align_model as load
    return load(language_code=language_code, device=device)


def align(*args, **kwargs):
    from .thirdParty.alignment import align as align_segments
    return align_segments(*args, **kwargs)
