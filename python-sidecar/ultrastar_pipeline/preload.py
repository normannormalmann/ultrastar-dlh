"""Modelle einmal laden: der Probelauf der Umgebungs-Einrichtung.

Erst wenn jede Modellart tatsaechlich geladen wurde, darf die Einrichtung
"fertig" melden - ein blosses pip-install beweist nur, dass Pakete liegen,
nicht dass Torch, CUDA und die Modell-Downloads zusammen funktionieren.
Geladen wird ueber dieselben Bibliotheksaufrufe wie im echten Lauf, damit
der Probelauf genau das prueft, was der erste Song brauchen wird.
"""

import json
from pathlib import Path

from . import separate, transcribe
from .cache import atomic_write_bytes
from .errors import LanguageUnsupported
from .progress import emit_progress


def preload(sprache: str, device: str, out: Path) -> None:
    """Laedt alle vier Modellarten und schreibt das Ergebnis nach `out`."""
    emit_progress("preload:demucs", 0.0)
    from demucs.pretrained import get_model

    get_model(separate.MODELL)
    emit_progress("preload:demucs", 1.0)

    emit_progress("preload:asr", 0.0)
    import whisperx

    try:
        whisperx.load_model(
            transcribe.MODELL,
            device,
            compute_type="float16" if device == "cuda" else "int8",
            language=sprache,
        )
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc
    emit_progress("preload:asr", 1.0)

    emit_progress("preload:align", 0.0)
    try:
        whisperx.load_align_model(language_code=sprache, device=device)
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise
        raise LanguageUnsupported(sprache) from exc
    emit_progress("preload:align", 1.0)

    emit_progress("preload:pitch", 0.0)
    from swift_f0 import SwiftF0

    SwiftF0()
    emit_progress("preload:pitch", 1.0)

    atomic_write_bytes(
        out,
        json.dumps(
            {
                "device": device,
                "modelle": {
                    "demucs": separate.MODELL,
                    "asr": transcribe.MODELL,
                    "align": sprache,
                    "pitch": "swift-f0",
                },
            },
            ensure_ascii=False,
        ).encode("utf8"),
    )
