"""Freie Transkription der Gesangsspur. Duenner Adapter, keine Entscheidungen.

Zweck ist nicht der Text — den kennen wir bereits — sondern die Zeit: die
gehoerten Woerter liefern Ankerpunkte, gegen die der bekannte Liedtext
ausgerichtet werden kann.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from . import separate
from .cache import atomic_write_bytes, stage_path
from .errors import LanguageUnsupported
from .progress import emit_progress

STAGE_VERSION = "1"
MODELL = "large-v2"


@dataclass(frozen=True)
class TranskriptWort:
    text: str
    start: float
    ende: float


def transcribe(
    vocals: Path, sprache: str, work_dir: Path, audio_hash: str, device: str
) -> list[TranskriptWort]:
    """Gehoerte Woerter mit Zeitstempeln."""
    # Die Identitaet der separate-Stufe geht in den Schluessel ein: ein
    # Transkript des alten Stems beschriebe Audio, das es nie gesehen hat.
    ziel = stage_path(
        work_dir,
        audio_hash,
        "transcribe",
        {
            "sprache": sprache,
            "modell": MODELL,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        gespeichert = json.loads(ziel.read_text(encoding="utf8"))
        emit_progress("transcribe", 1.0)
        return [TranskriptWort(**w) for w in gespeichert]

    emit_progress("transcribe", 0.0)
    import whisperx

    try:
        # language wird zusaetzlich zur Erkennung uebergeben: ohne sie faellt
        # whisperx auf automatische Spracherkennung zurueck, und die ist auf
        # einem stark bearbeiteten Gesangsstem unzuverlaessig — "fail loudly"
        # verlangt eine feste Sprache statt einer stillen Vermutung.
        modell = whisperx.load_model(
            MODELL, device, compute_type="float16" if device == "cuda" else "int8", language=sprache
        )
    except Exception as exc:  # kein ASR-Modell fuer diese Sprache
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc
    ergebnis = modell.transcribe(str(vocals), language=sprache)

    # Segmenttexte werden ueber Leerzeichen zerlegt: fuer Anker zaehlt die
    # Wortfolge, nicht die Segmentgrenze. Die Segmentdauer wird gleichmaessig
    # auf die Woerter verteilt — die genaue Zeit liefert spaeter das Forced
    # Alignment, hier genuegt eine Naeherung mit korrekter Reihenfolge.
    woerter: list[TranskriptWort] = []
    for segment in ergebnis.get("segments", []):
        stuecke = str(segment.get("text", "")).split()
        if not stuecke:
            continue
        start = float(segment.get("start", 0.0))
        ende = float(segment.get("end", start))
        schritt = (ende - start) / len(stuecke)
        for i, stueck in enumerate(stuecke):
            woerter.append(
                TranskriptWort(
                    text=stueck,
                    start=start + i * schritt,
                    ende=start + (i + 1) * schritt,
                )
            )

    atomic_write_bytes(
        ziel, json.dumps([w.__dict__ for w in woerter], ensure_ascii=False).encode("utf8")
    )
    emit_progress("transcribe", 1.0)
    return woerter
