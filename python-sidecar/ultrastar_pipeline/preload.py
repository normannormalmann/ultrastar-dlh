"""Modelle einmal laden: der Probelauf der Umgebungs-Einrichtung.

Erst wenn jede Modellart tatsaechlich geladen wurde, darf die Einrichtung
"fertig" melden - ein blosses pip-install beweist nur, dass Pakete liegen,
nicht dass Torch, CUDA und die Modell-Downloads zusammen funktionieren.
Geladen wird ueber dieselben Bibliotheksaufrufe wie im echten Lauf, damit
der Probelauf genau das prueft, was der erste Song brauchen wird.
"""

import json
from pathlib import Path

from . import modelle, modellwahl, separate, transcribe
from .cache import atomic_write_bytes
from .errors import LanguageUnsupported
from .progress import emit_progress


def preload(sprache: str, device: str, out: Path) -> None:
    """Laedt alle vier Modellarten, prueft die Silbentrennung und schreibt
    das Ergebnis nach `out`."""
    emit_progress("preload:demucs", 0.0)
    modelle.hole_demucs(separate.MODELL)
    emit_progress("preload:demucs", 1.0)

    emit_progress("preload:asr", 0.0)
    try:
        modelle.hole_asr(transcribe.MODELL, device, sprache)
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc
    emit_progress("preload:asr", 1.0)

    emit_progress("preload:align", 0.0)
    try:
        modelle.hole_align(sprache, device)
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise
        raise LanguageUnsupported(sprache) from exc
    emit_progress("preload:align", 1.0)

    emit_progress("preload:pitch", 0.0)
    modelle.hole_swiftf0()
    emit_progress("preload:pitch", 1.0)

    # Fuenfter Probe-Schritt: pyphen ueberlebte einmal einen fertigen
    # Durchstich, weil der Probelauf die Silbentrennung nie anfasste - erst
    # ein spaeterer echter Lauf haette das fehlende Paket gemeldet. Der Import
    # bleibt bewusst ungekapselt: fehlt pyphen, soll ModuleNotFoundError bis
    # zur bestehenden env_missing-Leitung durchschlagen, genau wie bei den
    # anderen vier Modellarten. Ein fehlendes Woerterbuch fuer eine einzelne
    # Sprache ist dagegen kein Fehler, nur eine Information im Ergebnis.
    emit_progress("preload:silben", 0.0)
    import pyphen  # noqa: F401 - Import selbst ist die Probe

    from .syllables import has_dictionary

    silben_ok = has_dictionary(sprache)
    emit_progress("preload:silben", 1.0)

    atomic_write_bytes(
        out,
        json.dumps(
            {
                "device": device,
                "modelle": {
                    "demucs": separate.MODELL,
                    "asr": transcribe.MODELL,
                    "align": sprache,
                    "pitch": modellwahl.PITCH,
                },
                "silben": silben_ok,
            },
            ensure_ascii=False,
        ).encode("utf8"),
    )
