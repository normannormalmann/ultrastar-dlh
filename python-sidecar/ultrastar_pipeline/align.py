"""Forced Alignment ueber WhisperX. Duenner Adapter."""

import hashlib
import json
from dataclasses import replace
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


def _dauer_sekunden(pfad: Path) -> float:
    """Laufzeit der WAV-Datei, ueber die Standardbibliothek."""
    import wave

    with wave.open(str(pfad), "rb") as w:
        return w.getnframes() / float(w.getframerate())


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


def align(
    vocals: Path,
    lines: list[str],
    language: str,
    work_dir: Path,
    audio_hash: str,
    device: str,
    warnungen: list[str],
) -> list[AlignedWord]:
    """Bekannte Zeilen auf die Gesangsspur ausrichten."""
    # Der Text geht mit in den Cache-Schluessel ein: sonst wuerde ein
    # geaenderter Liedtext bei gleicher Zeilenzahl eine veraltete
    # Ausrichtung fuer unveraendertes Audio wiederverwenden — ein leises,
    # falsches Ergebnis waere die Folge.
    text_digest = hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]
    ziel = stage_path(
        work_dir,
        audio_hash,
        "align",
        {"language": language, "lines": len(lines), "text": text_digest},
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        # Cache-Treffer: die Wortabweichung wird hier nicht neu berechnet,
        # also entsteht auch keine Warnung — selbst wenn beim urspruenglichen
        # Lauf eine Abweichung bestand. Bekannte Einschraenkung, siehe Bericht.
        emit_progress("align", 1.0)
        return [AlignedWord(**w) for w in json.loads(ziel.read_text(encoding="utf8"))]

    emit_progress("align", 0.0)
    import whisperx

    try:
        modell, metadaten = whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(language) from exc

    # Ein einziges Segment ueber die ganze Spur: Forced Alignment mit
    # bekanntem Text will einen Durchlauf ueber die komplette Aufnahme, nicht
    # pro Zeile ein eigenes (und damit zwangslaeufig falsches) Zeitfenster.
    # Die Zeilenzuordnung wird danach ueber die Wortanzahl je Zeile
    # rekonstruiert (zeilen_zuordnen), nicht ueber Segmentgrenzen.
    segmente = [{"text": " ".join(lines), "start": 0.0, "end": _dauer_sekunden(vocals)}]
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

    woerter, abweichung = zeilen_zuordnen(woerter, lines)
    # Eine Wortabweichung ist ein Indiz, dass Text und Audio nicht
    # zusammenpassen (fehlende Strophe, falscher Song) — dieselbe Klasse von
    # Signal wie die groesste Luecke, und darf darum nicht stumm bleiben.
    if abweichung > 0:
        warnungen.append(
            f"Alignment lieferte {abweichung} Wort(e) mehr, als der Liedtext erwarten liess."
        )
    elif abweichung < 0:
        warnungen.append(
            f"Alignment lieferte {-abweichung} Wort(e) weniger, als der Liedtext erwarten liess."
        )

    atomic_write_bytes(
        ziel, json.dumps([w.__dict__ for w in woerter], ensure_ascii=False).encode("utf8")
    )
    emit_progress("align", 1.0)
    return woerter
