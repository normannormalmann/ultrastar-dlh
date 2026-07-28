"""Forced Alignment ueber WhisperX. Duenner Adapter."""

import hashlib
import json
from dataclasses import replace
from pathlib import Path

from . import separate
from .anchors import Abschnitt
from .cache import atomic_write_bytes, stage_path
from .errors import LanguageUnsupported
from .notes import AlignedWord
from .progress import emit_progress

STAGE_VERSION = "1"

# Re-exportiert: bestehender Code und Tests importieren LanguageUnsupported
# von hier, die eigentliche Definition liegt aber in errors.py (Importzyklus,
# siehe dort).
__all__ = ["LanguageUnsupported", "AlignmentFailed", "align"]


class AlignmentFailed(Exception):
    """Alignment lieferte kein verwertbares Ergebnis."""


def dauer_sekunden(pfad: Path) -> float:
    """Laufzeit einer WAV-Datei, ueber die Standardbibliothek."""
    import wave

    with wave.open(str(pfad), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def dauer_oder_rueckfall(pfad: Path, rueckfall: float) -> float:
    """Wie dauer_sekunden, faellt aber auf einen Rueckfallwert zurueck.

    Fuer die berichtete Gesamtdauer: der letzte Zeitstempel des
    Tonhoehenverlaufs endet vor dem tatsaechlichen Ende der Aufnahme (die
    letzten unstimmhaften Millisekunden liefern keinen Punkt) und ist damit
    systematisch zu kurz. Nicht jede Datei ist aber eine lesbare WAV — dann
    bleibt der Rueckfallwert die einzige verfuegbare Naeherung.
    """
    try:
        return dauer_sekunden(pfad)
    except Exception:
        return rueckfall


def zeilen_zuordnen(
    woerter: list[AlignedWord], lines: list[str]
) -> tuple[list[AlignedWord], int]:
    """Ordnet flach ausgerichtete Woerter den Quellzeilen zu.

    Grundlage ist die Wortanzahl je Zeile, in der Reihenfolge des Textes.
    Liefert der Aligner mehr Woerter als erwartet, fallen die ueberzaehligen
    an die letzte Zeile; liefert er weniger, bleiben spaetere Zeilen leer.
    Beides ist eine Abweichung und darf nicht still bleiben, wirft hier aber
    nicht: die zweite Rueckgabe ist die Abweichung (Ist minus Soll), positiv
    bei Wortueberschuss, negativ bei Wortmangel, 0 bei Uebereinstimmung — der
    Aufrufer meldet sie als Warnung.
    """
    anzahl_je_zeile = [len(zeile.split()) for zeile in lines]
    abweichung = len(woerter) - sum(anzahl_je_zeile)

    if not woerter:
        return [], abweichung

    letzte_zeile = len(lines) - 1 if lines else 0

    zugeordnet: list[AlignedWord] = []
    index = 0
    for zeile_idx, anzahl in enumerate(anzahl_je_zeile):
        for _ in range(anzahl):
            if index >= len(woerter):
                return zugeordnet, abweichung
            zugeordnet.append(replace(woerter[index], line_index=zeile_idx))
            index += 1

    # Ueberzaehlige Woerter (Aligner liefert mehr, als die Zeilen erwarten
    # lassen) landen auf der letzten Zeile statt verworfen zu werden.
    while index < len(woerter):
        zugeordnet.append(replace(woerter[index], line_index=letzte_zeile))
        index += 1
    return zugeordnet, abweichung


def _melde_abweichung(abweichung: int, warnungen: list[str]) -> None:
    """Meldet eine Wortabweichung als Warnung — bei Neuberechnung wie bei
    Cache-Treffer, denn sie ist dasselbe Indiz in beiden Faellen: Text und
    Audio passen nicht zusammen (fehlende Strophe, falscher Song)."""
    if abweichung > 0:
        warnungen.append(
            f"Alignment lieferte {abweichung} Wort(e) mehr, als der Liedtext erwarten liess."
        )
    elif abweichung < 0:
        warnungen.append(
            f"Alignment lieferte {-abweichung} Wort(e) weniger, als der Liedtext erwarten liess."
        )


def align(
    vocals: Path,
    lines: list[str],
    language: str,
    work_dir: Path,
    audio_hash: str,
    device: str,
    warnungen: list[str],
    abschnitte: list[Abschnitt],
) -> list[AlignedWord]:
    """Bekannte Zeilen auf die Gesangsspur ausrichten."""
    # Der Text geht mit in den Cache-Schluessel ein: sonst wuerde ein
    # geaenderter Liedtext bei gleicher Zeilenzahl eine veraltete
    # Ausrichtung fuer unveraendertes Audio wiederverwenden — ein leises,
    # falsches Ergebnis waere die Folge.
    text_digest = hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]
    # Die Abschnittsstruktur geht ebenfalls in den Schluessel ein: sonst
    # liefert ein Treffer eine Ausrichtung nach altem Schnitt, obwohl sich
    # die Ankerlage (und damit die Segmentgrenzen) inzwischen geaendert hat.
    abschnitt_digest = hashlib.sha256(
        json.dumps(
            [[a.von_index, a.bis_index, a.start_s, a.ende_s] for a in abschnitte]
        ).encode("utf8")
    ).hexdigest()[:16]
    # Die Identitaet der separate-Stufe geht mit in den Schluessel ein: sonst
    # wuerde eine geanderte Stimmtrennung (neues Modell, neue Version) eine
    # Ausrichtung wiederverwenden, die noch auf dem alten Stem beruht.
    ziel = stage_path(
        work_dir,
        audio_hash,
        "align",
        {
            "language": language,
            "lines": len(lines),
            "text": text_digest,
            "abschnitte": abschnitt_digest,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        # Die Abweichung wird mitgecacht, nicht neu berechnet — sonst wuerde
        # die Warnung bei einem Cache-Treffer verschwinden, obwohl der
        # urspruengliche Lauf sie gemeldet hatte.
        gespeichert = json.loads(ziel.read_text(encoding="utf8"))
        _melde_abweichung(gespeichert["deviation"], warnungen)
        emit_progress("align", 1.0)
        return [AlignedWord(**w) for w in gespeichert["words"]]

    emit_progress("align", 0.0)
    import whisperx

    try:
        modell, metadaten = whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(language) from exc

    # Ein Segment je Abschnitt statt eines ueber die ganze Aufnahme. Der
    # bisherige Ansatz liess den Aligner den Text blind ueber die volle
    # Laenge verteilen; gemessen ergab das lokales Verrutschen bis in den
    # Sekundenbereich (Zehntel-Mittel bis 2827 ms). Die Zeilenzuordnung wird
    # danach weiterhin ueber die Wortanzahl je Zeile rekonstruiert
    # (zeilen_zuordnen), nicht ueber diese Segmentgrenzen.
    flach = [wort for zeile in lines for wort in zeile.split()]
    # Die Abschnittsgrenzen wurden gegen eine anderswo gebildete Wortliste
    # berechnet. Stimmt deren Laenge nicht mit der hiesigen ueberein, greifen
    # die Grenzen auf falsche Woerter und der Filter unten wuerde den Verlust
    # verschlucken. Lieber hier abbrechen als still falsch ausrichten.
    if abschnitte and abschnitte[-1].bis_index != len(flach):
        raise AlignmentFailed(
            f"Abschnitte decken {abschnitte[-1].bis_index} Woerter ab, "
            f"der Text hat {len(flach)}"
        )
    segmente = [
        {
            "text": " ".join(flach[a.von_index : a.bis_index]),
            "start": a.start_s,
            "end": a.ende_s,
        }
        for a in abschnitte
        if flach[a.von_index : a.bis_index]
    ]
    if not segmente:
        segmente = [
            {"text": " ".join(lines), "start": 0.0, "end": dauer_sekunden(vocals)}
        ]
    ergebnis = whisperx.align(
        segmente, modell, metadaten, str(vocals), device, return_char_alignments=False
    )

    woerter: list[AlignedWord] = []
    for segment in ergebnis.get("segments", []):
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
                    line_index=0,  # wird unten durch zeilen_zuordnen ersetzt
                )
            )

    if not woerter:
        raise AlignmentFailed("keine Woerter zugeordnet")

    # Wir haengen die Woerter aller Segmente hintereinander und setzen dabei
    # voraus, dass sie in Eingabereihenfolge zurueckkommen. Stimmt das nicht,
    # waere die ganze Ausrichtung verschoben - sichtbar machen, nicht annehmen.
    rueckwaerts = sum(1 for a, b in zip(woerter, woerter[1:]) if b.start < a.start)
    if rueckwaerts:
        warnungen.append(
            f"{rueckwaerts} Woerter liegen zeitlich vor ihrem Vorgaenger; "
            "die Segmentreihenfolge des Aligners ist nicht monoton."
        )

    woerter, abweichung = zeilen_zuordnen(woerter, lines)
    _melde_abweichung(abweichung, warnungen)

    atomic_write_bytes(
        ziel,
        json.dumps(
            {"words": [w.__dict__ for w in woerter], "deviation": abweichung},
            ensure_ascii=False,
        ).encode("utf8"),
    )
    emit_progress("align", 1.0)
    return woerter
