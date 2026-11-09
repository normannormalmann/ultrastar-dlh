"""Alignment + Tonhoehe + Tempo -> UltraStar-Noten.

Bewusst rein: keine Modelle, kein Dateisystem, keine GPU. Hier wird die
Sync-Qualitaet entschieden, und genau deshalb muss dieses Modul in
Millisekunden testbar bleiben — sonst laeuft bei jeder Justierung Demucs.
"""

from dataclasses import dataclass, replace
import math
from statistics import median

from .syllables import split_syllables


@dataclass(frozen=True)
class AlignedWord:
    text: str
    start: float  # Sekunden
    end: float
    confidence: float
    line_index: int
    # Herkunft des Zeitstempels (anchor/fuzzy/realign/lrc/interpolated).
    # Der Standardwert haelt bestehende Fixtures und Aufrufer gueltig.
    quelle: str = "anchor"


@dataclass(frozen=True)
class PitchPoint:
    time: float  # Sekunden
    midi: float
    voiced: bool
    confidence: float | None = None
    source: str | None = None


@dataclass(frozen=True)
class Note:
    beat: int
    length: int
    pitch: int
    syllable: str
    confidence: float
    pitch_status: str | None = None
    timing_confidence: float | None = None


@dataclass(frozen=True)
class LineBreak:
    after_note_index: int
    beat: int


# UltraStar pitch 0 is MIDI 60. Legacy artifacts retain their own midiOffset.
MIDI_NULLAGE = 60
STAGE_VERSION = "3"
MAX_TIMING_SHIFT_SEC = 0.020
MAX_TICK_SEC = 0.010


class NoteTimingError(ValueError):
    """The measured timing cannot be exported without inventing new onsets."""


def export_bpm(musical_bpm: float) -> float:
    """Use an integer tempo multiple with at most 10 ms per export tick."""
    if not math.isfinite(musical_bpm) or musical_bpm <= 0:
        raise NoteTimingError("Ungültiges Songtempo.")
    result = musical_bpm
    while 60 / (result * 4) > MAX_TICK_SEC:
        result *= 2
    return result


def _beats_pro_sekunde(bpm: float, beats_per_bpm_unit: int) -> float:
    return bpm * beats_per_bpm_unit / 60.0


def _mittlere_tonhoehe(
    pitch: list[PitchPoint], von: float, bis: float
) -> int | None:
    werte = [p.midi for p in pitch if p.voiced and von <= p.time < bis and math.isfinite(p.midi) and p.midi > 0]
    if not werte:
        return None
    return int(round(median(werte))) - MIDI_NULLAGE


def build_notes(
    words: list[AlignedWord],
    pitch: list[PitchPoint],
    bpm: float,
    language: str,
    beats_per_bpm_unit: int = 4,
) -> tuple[list[Note], list[LineBreak], int, list[int]]:
    """Noten, Zeilenumbrueche, GAP (ms) und Wort->Note-Zuordnung bauen.

    Die vierte Rueckgabe (wort_zu_note) nennt zu jedem Eingabewort den Index
    seiner ersten Note, mit einem abschliessenden Element gleich der
    Gesamtzahl der Noten (bei n Woertern also n + 1 Eintraege). Ein
    Wortbereich [von, bis) entspricht damit dem Notenbereich
    [wort_zu_note[von], wort_zu_note[bis]).

    Diese Zuordnung wird hier mitgeliefert statt anderswo nachgerechnet:
    die Silbenzahl je Wort ist nicht konstant (siehe unten) und ein Wort
    kann null Silben ergeben, in welchem Fall zwei aufeinanderfolgende
    Eintraege gleich sind. Nur hier, direkt beim Silben-Splitting, ist diese
    Zuordnung ohne zweite, potenziell abweichende Berechnung bekannt; eine
    Nachberechnung ausserhalb waere eine zweite Quelle derselben Wahrheit.
    """
    if not words:
        return [], [], 0, [0]

    if not math.isfinite(bpm) or bpm <= 0 or beats_per_bpm_unit <= 0:
        raise NoteTimingError("Ungültige Zeitauflösung.")
    for i, word in enumerate(words):
        if not all(math.isfinite(v) for v in (word.start, word.end)) or word.start < 0 or word.end <= word.start:
            raise NoteTimingError(f"Ungültiger Zeitbereich bei Wort {i + 1}. Bitte Text und Audiofassung prüfen.")
    bps = _beats_pro_sekunde(bpm, beats_per_bpm_unit)
    gap_sekunden = words[0].start
    gap_ms = int(round(gap_sekunden * 1000))

    noten: list[Note] = []
    onsets: list[float] = []
    umbrueche: list[LineBreak] = []
    wort_zu_note: list[int] = []
    letzte_zeile = words[0].line_index

    for wort in words:
        # Vor dem Silben-Splitting festhalten: der erste Notenindex dieses
        # Wortes ist der aktuelle Notenstand. Ergibt das Wort keine Silben,
        # bleibt dieser Wert unveraendert und der naechste Eintrag ist gleich
        # (siehe Docstring).
        wort_zu_note.append(len(noten))

        # Silben zuerst bestimmen: ein Wort ohne Silben (z. B. leerer Text)
        # erzeugt keine Note. Wuerde die Zeile trotzdem verbucht, entstuende
        # beim naechsten echten Zeilenwechsel ein zweiter Umbruch mit
        # demselben after_note_index.
        silben = split_syllables(wort.text, language)
        if not silben:
            continue

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

        dauer = max(wort.end - wort.start, 1e-3)
        pro_silbe = dauer / len(silben)

        for i, silbe in enumerate(silben):
            von = wort.start + i * pro_silbe
            bis = von + pro_silbe
            # Worttrennung im UltraStar-Format: die letzte Silbe eines Wortes
            # traegt ein trailing space als Trennzeichen zum naechsten Wort.
            # Nur hier ist bekannt, wo ein Wort endet (ein AlignedWord pro
            # Wort) — die Serialisierung schreibt die Silbe nur noch verbatim.
            ist_letzte_silbe = i == len(silben) - 1
            measured_pitch = _mittlere_tonhoehe(pitch, von, bis)
            pitch_scores = [p.confidence for p in pitch if p.voiced and von <= p.time < bis
                            and p.confidence is not None and math.isfinite(p.confidence)
                            and 0 <= p.confidence <= 1 and math.isfinite(p.midi) and p.midi > 0]
            confidence = min(wort.confidence, median(pitch_scores)) if pitch_scores else wort.confidence
            onsets.append(von)
            noten.append(
                Note(
                    beat=int(round((von - gap_sekunden) * bps)),
                    length=max(1, int(round(pro_silbe * bps))),
                    # Numeric placeholder only; missing pitches export as unscored freestyle.
                    pitch=measured_pitch if measured_pitch is not None else 0,
                    syllable=f"{silbe} " if ist_letzte_silbe else silbe,
                    confidence=confidence if measured_pitch is not None else 0.0,
                    pitch_status="measured" if measured_pitch is not None else "missing",
                    timing_confidence=wort.confidence,
                )
            )

    # Bound displacement against the original onset, never against a shifted neighbour.
    # A chain of individually small corrections must not accumulate into seconds.
    for i in range(1, len(noten)):
        mindest = noten[i - 1].beat + 1
        beat = max(noten[i].beat, mindest)
        if abs(gap_ms / 1000 + beat / bps - onsets[i]) > MAX_TIMING_SHIFT_SEC + 1e-9:
            raise NoteTimingError(
                f"Zeitkonflikt bei Note {i + 1} ({onsets[i]:.2f} s): "
                "Eine Korrektur würde den Einsatz um mehr als 20 ms verschieben. "
                "Bitte Textfolge, Audiofassung und überlappende Stimmen prüfen."
            )
        noten[i] = replace(noten[i], beat=beat)

    # ... dann die Laengen kuerzen, damit keine Note in die naechste
    # hineinreicht. Kuerzen statt Verschieben: der Einsatzzeitpunkt ist die
    # singbare Groesse und bleibt so erhalten.
    for i in range(len(noten) - 1):
        platz = noten[i + 1].beat - noten[i].beat
        if noten[i].length > platz:
            noten[i] = replace(noten[i], length=max(1, platz))

    # Umbruch-Beats stammen aus den unverschobenen Zeiten, die Normalisierung
    # hat die Noten aber nach hinten geschoben. Jeden Umbruch daher in die
    # Luecke zwischen der Note, der er folgt, und der naechsten klemmen.
    geklemmt: list[LineBreak] = []
    for umbruch in umbrueche:
        i = umbruch.after_note_index
        if i + 1 >= len(noten):
            continue                      # kein Umbruch hinter der letzten Note
        untere = noten[i].beat + noten[i].length
        obere = noten[i + 1].beat
        geklemmt.append(
            replace(umbruch, beat=min(max(umbruch.beat, untere), obere))
        )
    umbrueche = geklemmt

    # Abschliessendes Element: Gesamtzahl der Noten, damit ein Wortbereich
    # [von, bis) sich als [wort_zu_note[von], wort_zu_note[bis]) lesen laesst
    # auch dann, wenn bis das letzte Wort ist.
    wort_zu_note.append(len(noten))

    return noten, umbrueche, gap_ms, wort_zu_note
