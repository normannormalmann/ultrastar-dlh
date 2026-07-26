"""Alignment + Tonhoehe + Tempo -> UltraStar-Noten.

Bewusst rein: keine Modelle, kein Dateisystem, keine GPU. Hier wird die
Sync-Qualitaet entschieden, und genau deshalb muss dieses Modul in
Millisekunden testbar bleiben — sonst laeuft bei jeder Justierung Demucs.
"""

from dataclasses import dataclass
from statistics import median

from .syllables import split_syllables


@dataclass(frozen=True)
class AlignedWord:
    text: str
    start: float  # Sekunden
    end: float
    confidence: float
    line_index: int


@dataclass(frozen=True)
class PitchPoint:
    time: float  # Sekunden
    midi: float
    voiced: bool


@dataclass(frozen=True)
class Note:
    beat: int
    length: int
    pitch: int
    syllable: str
    confidence: float


@dataclass(frozen=True)
class LineBreak:
    after_note_index: int
    beat: int


# UltraStar-Tonhoehe 0 entspricht C4 (MIDI 60). Eine Annahme, keine Messung
# (siehe Aufgabenbeschreibung) — bewusst benannt und isoliert, nicht inlinen.
MIDI_NULLAGE = 60


def _beats_pro_sekunde(bpm: float, beats_per_bpm_unit: int) -> float:
    return bpm * beats_per_bpm_unit / 60.0


def _mittlere_tonhoehe(
    pitch: list[PitchPoint], von: float, bis: float, rueckfall: int
) -> int:
    werte = [p.midi for p in pitch if p.voiced and von <= p.time < bis and p.midi > 0]
    if not werte:
        return rueckfall
    return int(round(median(werte))) - MIDI_NULLAGE


def build_notes(
    words: list[AlignedWord],
    pitch: list[PitchPoint],
    bpm: float,
    language: str,
    beats_per_bpm_unit: int = 4,
) -> tuple[list[Note], list[LineBreak], int]:
    """Noten, Zeilenumbrueche und GAP (ms) aus dem Alignment bauen."""
    if not words:
        return [], [], 0

    bps = _beats_pro_sekunde(bpm, beats_per_bpm_unit)
    gap_sekunden = words[0].start
    gap_ms = int(round(gap_sekunden * 1000))

    # Globaler Rueckfall fuer Woerter ohne verwertbare Tonhoehe.
    gesungen = [p.midi for p in pitch if p.voiced and p.midi > 0]
    rueckfall = int(round(median(gesungen))) - MIDI_NULLAGE if gesungen else 0

    noten: list[Note] = []
    umbrueche: list[LineBreak] = []
    letzte_zeile = words[0].line_index

    for wort in words:
        if wort.line_index != letzte_zeile:
            # Umbruch nur, wenn schon Noten existieren — sonst gibt es
            # nichts zu trennen.
            if noten:
                umbrueche.append(
                    LineBreak(
                        after_note_index=len(noten) - 1,
                        beat=int(round((wort.start - gap_sekunden) * bps)),
                    )
                )
            letzte_zeile = wort.line_index

        silben = split_syllables(wort.text, language)
        if not silben:
            continue

        dauer = max(wort.end - wort.start, 1e-3)
        pro_silbe = dauer / len(silben)

        for i, silbe in enumerate(silben):
            von = wort.start + i * pro_silbe
            bis = von + pro_silbe
            noten.append(
                Note(
                    beat=int(round((von - gap_sekunden) * bps)),
                    length=max(1, int(round(pro_silbe * bps))),
                    pitch=_mittlere_tonhoehe(pitch, von, bis, rueckfall),
                    syllable=silbe,
                    confidence=wort.confidence,
                )
            )

    return noten, umbrueche, gap_ms
