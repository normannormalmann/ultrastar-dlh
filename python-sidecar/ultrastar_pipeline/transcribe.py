"""Freie Transkription der Gesangsspur. Duenner Adapter, keine Entscheidungen.

Zweck ist nicht der Text - den kennen wir bereits - sondern die Zeit: die
gehoerten Woerter liefern gemessene Ankerpunkte (via Forced Alignment), gegen
die der bekannte Liedtext ausgerichtet werden kann.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from . import modelle, separate
from .cache import atomic_write_bytes, stage_path
from .errors import LanguageUnsupported
from .progress import emit_progress

STAGE_VERSION = "2"
MODELL = "large-v2"


@dataclass(frozen=True)
class TranskriptWort:
    text: str
    start: float
    ende: float
    # Phonetischer Score des Forced Alignments. Bei Gesang systematisch
    # niedrig (0,0-0,35 auch bei korrekter Zeit) - Anzeige und
    # Misstrauensregel, nie Verwurfskriterium.
    score: float = 0.0


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
        modell = modelle.hole_asr(MODELL, device, sprache)
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            # GPU-Speicher voll ist keine Sprachfrage - der generische
            # Handler in __main__ gibt dafuer den richtigen Rat.
            raise
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc  # kein ASR-Modell fuer diese Sprache
    ergebnis = modell.transcribe(str(vocals), language=sprache)

    # Pass 1 des Vierpass-Modells: das Transkript selbst wird ausgerichtet.
    # Die Segmentzeiten von Whisper sind Schaetzungen (gemessen: erster
    # Anker geschaetzt 6,4 s, gesungen 10,5 s); erst das Forced Alignment
    # macht aus gehoerten Woertern *gemessene* Zeiten.
    try:
        align_modell, metadaten = modelle.hole_align(sprache, device)
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            # GPU-Speicher voll ist keine Sprachfrage - der generische
            # Handler in __main__ gibt dafuer den richtigen Rat.
            raise
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc  # kein Alignment-Modell fuer diese Sprache
    ausgerichtet = whisperx.align(
        ergebnis.get("segments", []),
        align_modell,
        metadaten,
        str(vocals),
        device,
        return_char_alignments=False,
    )

    woerter: list[TranskriptWort] = []
    for segment in ausgerichtet.get("segments", []):
        for wort in segment.get("words", []):
            # Ohne Zeitstempel kein Anker: ein erfundener Wert waere
            # schlimmer als ein fehlendes Wort.
            if wort.get("start") is None or wort.get("end") is None:
                continue
            text = str(wort.get("word", "")).strip()
            if not text:
                continue
            woerter.append(
                TranskriptWort(
                    text=text,
                    start=float(wort["start"]),
                    ende=float(wort["end"]),
                    score=float(wort.get("score", 0.0)),
                )
            )

    atomic_write_bytes(
        ziel, json.dumps([w.__dict__ for w in woerter], ensure_ascii=False).encode("utf8")
    )
    emit_progress("transcribe", 1.0)
    return woerter
