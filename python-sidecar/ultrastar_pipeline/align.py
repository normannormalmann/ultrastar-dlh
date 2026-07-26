"""Forced Alignment ueber WhisperX. Duenner Adapter."""

import json
from pathlib import Path

from .cache import atomic_write_bytes, stage_path
from .notes import AlignedWord
from .progress import emit_progress

STAGE_VERSION = "1"


class LanguageUnsupported(Exception):
    """Fuer diese Sprache gibt es kein Alignment-Modell."""

    def __init__(self, language: str) -> None:
        super().__init__(language)
        self.language = language


class AlignmentFailed(Exception):
    """Alignment lieferte kein verwertbares Ergebnis."""


def align(
    vocals: Path,
    lines: list[str],
    language: str,
    work_dir: Path,
    audio_hash: str,
    device: str,
) -> list[AlignedWord]:
    """Bekannte Zeilen auf die Gesangsspur ausrichten."""
    ziel = stage_path(
        work_dir,
        audio_hash,
        "align",
        {"language": language, "lines": len(lines)},
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        emit_progress("align", 1.0)
        return [AlignedWord(**w) for w in json.loads(ziel.read_text(encoding="utf8"))]

    emit_progress("align", 0.0)
    import whisperx

    try:
        modell, metadaten = whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(language) from exc

    # Jede Textzeile wird ein Segment: die Zeilenzuordnung bleibt damit
    # erhalten und liefert spaeter die Zeilenumbrueche.
    segmente = [{"text": zeile, "start": 0.0, "end": 0.0} for zeile in lines]
    ergebnis = whisperx.align(
        segmente, modell, metadaten, str(vocals), device, return_char_alignments=False
    )

    woerter: list[AlignedWord] = []
    for i, segment in enumerate(ergebnis.get("segments", [])):
        for wort in segment.get("words", []):
            if wort.get("start") is None or wort.get("end") is None:
                continue
            text = str(wort.get("word", "")).strip()
            if not text:
                continue
            woerter.append(
                AlignedWord(
                    text=text,
                    start=float(wort["start"]),
                    end=float(wort["end"]),
                    confidence=float(wort.get("score", 0.0)),
                    line_index=i,
                )
            )

    if not woerter:
        raise AlignmentFailed("keine Woerter zugeordnet")

    atomic_write_bytes(
        ziel, json.dumps([w.__dict__ for w in woerter], ensure_ascii=False).encode("utf8")
    )
    emit_progress("align", 1.0)
    return woerter
