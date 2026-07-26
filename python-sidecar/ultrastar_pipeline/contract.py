"""Serialisierung nach song_data.json.

Python kennt das UltraStar-Format nicht — es liefert nur diesen Vertrag.
Das .txt schreibt TypeScript.
"""

from statistics import median
from typing import Any

from .notes import LineBreak, Note

SCHEMA_VERSION = 1

# Unter diesem Median gilt das Gesamtergebnis als unsicher.
KONFIDENZ_SCHWELLE = 0.5
# Einzelne Woerter unter diesem Wert zaehlen als unsicher.
UNSICHER_AB = 0.6


def baue_song_data(
    *,
    bpm: float,
    gap: int,
    language: str,
    notes: list[Note],
    line_breaks: list[LineBreak],
    duration_sec: float,
    device: str,
    stage_versions: dict[str, str],
    warnings: list[str],
    largest_gap_sec: float = 0.0,
) -> dict[str, Any]:
    """Vertragsobjekt bauen, inklusive aggregierter Konfidenz."""
    konfidenzen = [n.confidence for n in notes]
    med = median(konfidenzen) if konfidenzen else 0.0
    unsicher = (
        sum(1 for c in konfidenzen if c < UNSICHER_AB) / len(konfidenzen)
        if konfidenzen
        else 0.0
    )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "bpm": bpm,
        "gap": gap,
        "language": language,
        "notes": [
            {
                "beat": n.beat,
                "length": n.length,
                "pitch": n.pitch,
                "syllable": n.syllable,
                "confidence": n.confidence,
            }
            for n in notes
        ],
        "lineBreaks": [
            {"afterNoteIndex": b.after_note_index, "beat": b.beat} for b in line_breaks
        ],
        "meta": {
            "durationSec": duration_sec,
            "device": device,
            "stageVersions": stage_versions,
            "warnings": warnings,
            "confidence": {
                "median": med,
                "unsureRatio": unsicher,
                "largestGapSec": largest_gap_sec,
            },
            "lowConfidence": bool(notes) and med < KONFIDENZ_SCHWELLE,
        },
    }
