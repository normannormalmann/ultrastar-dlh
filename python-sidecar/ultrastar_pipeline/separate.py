"""Stimmtrennung ueber Demucs. Duenner Adapter, sonst nichts.

Die Modell-Importe stehen absichtlich in der Funktion: so bleibt der
Modulkopf modellfrei und der Import kostet nichts, solange nicht getrennt
wird.
"""

from pathlib import Path

from . import modelle
from .cache import atomic_write_bytes, stage_path
from .progress import emit_progress

STAGE_VERSION = "1"
MODELL = "htdemucs"


def separate(audio: Path, work_dir: Path, audio_hash: str, device: str) -> Path:
    """Gesangsspur erzeugen und cachen. Gibt den Pfad zur vocals.wav zurueck."""
    ziel = stage_path(work_dir, audio_hash, "separate", {"model": MODELL}, STAGE_VERSION, ".wav")
    if ziel.is_file():
        emit_progress("separate", 1.0)
        return ziel

    emit_progress("separate", 0.0)
    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio

    modell = modelle.hole_demucs(MODELL)
    modell.to(device)
    modell.eval()

    wav = AudioFile(audio).read(
        streams=0, samplerate=modell.samplerate, channels=modell.audio_channels
    )
    referenz = wav.mean(0)
    wav = (wav - referenz.mean()) / referenz.std()

    with torch.no_grad():
        quellen = apply_model(modell, wav[None], device=device, progress=False)[0]
    quellen = quellen * referenz.std() + referenz.mean()

    roh = ziel.with_suffix(".roh.wav")
    roh.parent.mkdir(parents=True, exist_ok=True)
    save_audio(quellen[modell.sources.index("vocals")], str(roh), modell.samplerate)
    atomic_write_bytes(ziel, roh.read_bytes())
    roh.unlink(missing_ok=True)

    emit_progress("separate", 1.0)
    return ziel
