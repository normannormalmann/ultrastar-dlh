import hashlib
import json
import sys
import types
import wave
from pathlib import Path

import pytest

from ultrastar_pipeline import separate
from ultrastar_pipeline.align import (
    AlignmentFailed,
    LanguageUnsupported,
    align,
    dauer_oder_rueckfall,
    zeilen_zuordnen,
)
from ultrastar_pipeline.cache import atomic_write_bytes, stage_path
from ultrastar_pipeline.notes import AlignedWord


def w(text, i=0):
    """AlignedWord mit Platzhalter-Zeiten; line_index absichtlich falsch (99),
    damit ein Test wirklich prueft, dass zeilen_zuordnen ihn ueberschreibt."""
    return AlignedWord(text=text, start=float(i), end=float(i) + 0.5, confidence=0.9, line_index=99)


def test_exakte_zuordnung_ueber_mehrere_zeilen():
    lines = ["eins zwei", "drei", "vier fuenf sechs"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei", "drei", "vier", "fuenf", "sechs"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 0, 1, 2, 2, 2]
    # Text und Zeitwerte bleiben unveraendert, nur line_index wird ersetzt.
    assert [e.text for e in ergebnis] == [e.text for e in woerter]
    assert abweichung == 0  # Anzahl stimmt genau ueberein


def test_ueberzaehlige_woerter_fallen_an_die_letzte_zeile():
    lines = ["eins", "zwei"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei", "extra1", "extra2"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 1, 1, 1]
    assert abweichung == 2  # zwei Woerter mehr als die Zeilen erwarten liessen


def test_fehlende_woerter_lassen_spaetere_zeilen_leer():
    lines = ["eins", "zwei", "drei"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    # Nur zwei Woerter geliefert: die dritte Zeile bekommt nichts, statt dass
    # etwas erfunden wird.
    assert [e.line_index for e in ergebnis] == [0, 1]
    assert len(ergebnis) == 2
    assert abweichung == -1  # ein Wort weniger als die Zeilen erwarten liessen


def test_einzelne_zeile_bekommt_alle_woerter():
    lines = ["ein einziges wort hier"]
    woerter = [w(t, i) for i, t in enumerate(["ein", "einziges", "wort", "hier"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 0, 0, 0]
    assert abweichung == 0


def test_leere_wortliste_ergibt_leere_liste():
    ergebnis, abweichung = zeilen_zuordnen([], ["eins", "zwei"])
    assert ergebnis == []
    assert abweichung == -2  # zwei erwartete Woerter, keines geliefert


def _cache_pfad(work_dir: Path, audio_hash: str, lines: list[str], language: str = "de") -> Path:
    text_digest = hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]
    # Diese Tests rufen align() stets mit leerer Abschnittsliste auf; der
    # Digest muss deshalb genau den einer leeren Liste treffen.
    abschnitt_digest = hashlib.sha256(json.dumps([]).encode("utf8")).hexdigest()[:16]
    return stage_path(
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
        "1",
        ".json",
    )


def test_wortabweichung_warnung_bleibt_bei_cache_treffer_erhalten(tmp_path):
    """align() darf die Abweichungswarnung nicht nur beim ersten Lauf melden
    — sie ist mitgecacht, muss also auch beim zweiten (Cache-Treffer) wieder
    in den Warnungen landen."""
    lines = ["eins zwei"]
    woerter = [{"text": "eins", "start": 0.0, "end": 0.5, "confidence": 0.9, "line_index": 0}]
    atomic_write_bytes(
        _cache_pfad(tmp_path, "hash123", lines),
        json.dumps({"words": woerter, "deviation": -1}, ensure_ascii=False).encode("utf8"),
    )

    warnungen: list[str] = []
    ergebnis = align(Path("egal.wav"), lines, "de", tmp_path, "hash123", "cpu", warnungen, [])

    assert len(ergebnis) == 1
    assert any("weniger" in w for w in warnungen)


def test_ausgeglichene_abweichung_erzeugt_bei_cache_treffer_keine_warnung(tmp_path):
    lines = ["eins zwei"]
    woerter = [
        {"text": "eins", "start": 0.0, "end": 0.5, "confidence": 0.9, "line_index": 0},
        {"text": "zwei", "start": 0.6, "end": 1.0, "confidence": 0.9, "line_index": 0},
    ]
    atomic_write_bytes(
        _cache_pfad(tmp_path, "hash456", lines),
        json.dumps({"words": woerter, "deviation": 0}, ensure_ascii=False).encode("utf8"),
    )

    warnungen: list[str] = []
    align(Path("egal.wav"), lines, "de", tmp_path, "hash456", "cpu", warnungen, [])
    assert warnungen == []


def test_separate_versionswechsel_invalidiert_den_align_cache(tmp_path, monkeypatch):
    """separate.STAGE_VERSION geht in den align-Cache-Schluessel ein: eine
    geanderte Stimmtrennung darf keine Ausrichtung wiederverwenden, die noch
    auf dem alten Stem beruht. Nachweis: derselbe Cache-Inhalt ist nach dem
    Versionswechsel ein Treffer unter dem alten, aber ein Fehlschlag unter
    dem neuen Pfad.

    Der Fehlschlag wird an einem vorgeschalteten Platzhalter-whisperx
    abgelesen, der jeden Zugriff mitzaehlt. Vorher diente der Importfehler des
    echten Pakets als Beweis — das prueft die Umgebung statt des Caches und
    faellt in dem Moment um, in dem die Modelle wirklich installiert sind.
    """
    lines = ["eins"]
    ziel = _cache_pfad(tmp_path, "hashXYZ", lines)
    atomic_write_bytes(
        ziel, json.dumps({"words": [], "deviation": 0}, ensure_ascii=False).encode("utf8")
    )

    zugriffe: list[str] = []

    def load_align_model(language_code: str, device: str):
        zugriffe.append(language_code)
        raise RuntimeError("Platzhalter: dieser Test laedt kein Modell")

    platzhalter = types.ModuleType("whisperx")
    platzhalter.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", platzhalter)

    # Vor dem Versionswechsel: Cache-Treffer, das Modell bleibt unberuehrt.
    assert align(Path("egal.wav"), lines, "de", tmp_path, "hashXYZ", "cpu", [], []) == []
    assert zugriffe == []

    monkeypatch.setattr(separate, "STAGE_VERSION", "999")
    # Derselbe Cache-Inhalt liegt jetzt unter einem anderen Pfad -> Treffer
    # bleibt aus, der Aligner wird angefasst. Dass daraus LanguageUnsupported
    # wird, ist nur die Huelle des Platzhalter-Fehlers; entscheidend ist der
    # gezaehlte Zugriff.
    with pytest.raises(LanguageUnsupported):
        align(Path("egal.wav"), lines, "de", tmp_path, "hashXYZ", "cpu", [], [])
    assert zugriffe == ["de"]


def test_dauer_oder_rueckfall_liest_die_echte_wav_laenge(tmp_path):
    pfad = tmp_path / "clip.wav"
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(100)
        w.writeframes(b"\x00\x00" * 250)  # 2.5 Sekunden bei 100 Hz
    assert dauer_oder_rueckfall(pfad, 999.0) == pytest.approx(2.5)


def test_dauer_oder_rueckfall_faellt_bei_unlesbarer_datei_auf_den_rueckfall_zurueck(tmp_path):
    pfad = tmp_path / "kaputt.wav"
    pfad.write_bytes(b"kein echtes wav")
    assert dauer_oder_rueckfall(pfad, 4.1) == 4.1


from ultrastar_pipeline.anchors import Abschnitt


def test_je_abschnitt_entsteht_ein_segment_mit_eigenem_zeitfenster(tmp_path, monkeypatch):
    """Der Kern der Ueberarbeitung: nicht mehr ein Segment ueber die ganze
    Aufnahme, sondern eines je Abschnitt - sonst verteilt der Aligner den
    Text blind ueber die volle Laenge."""
    gesehen: list[list[dict]] = []

    def load_align_model(language_code, device):
        return object(), {}

    def align_stub(segmente, modell, metadaten, audio, device, return_char_alignments):
        gesehen.append(segmente)
        return {
            "segments": [
                {
                    "words": [
                        {"word": w, "start": float(i), "end": float(i) + 0.5, "score": 0.9}
                        for i, w in enumerate(str(s["text"]).split())
                    ]
                }
                for s in segmente
            ]
        }

    platzhalter = types.ModuleType("whisperx")
    platzhalter.load_align_model = load_align_model
    platzhalter.align = align_stub
    monkeypatch.setitem(sys.modules, "whisperx", platzhalter)

    lines = ["eins zwei", "drei vier"]
    abschnitte = [
        Abschnitt(0, 2, 0.0, 5.0, 1.0, False),
        Abschnitt(2, 4, 4.7, 10.0, 1.0, False),
    ]
    align(Path("egal.wav"), lines, "de", tmp_path, "hashSeg", "cpu", [], abschnitte)

    assert len(gesehen) == 1, "ein einziger Modellaufruf, wie bisher"
    segmente = gesehen[0]
    assert len(segmente) == 2
    assert (segmente[0]["start"], segmente[0]["end"]) == (0.0, 5.0)
    assert (segmente[1]["start"], segmente[1]["end"]) == (4.7, 10.0)
    assert segmente[0]["text"] == "eins zwei"
    assert segmente[1]["text"] == "drei vier"


def test_abschnitte_gegen_falsche_wortzahl_schlagen_laut_fehl(tmp_path, monkeypatch):
    """Die Abschnittsgrenzen wurden anderswo gegen eine Wortliste berechnet.
    Stimmt deren Laenge nicht mit der hiesigen ueberein, darf das nicht still
    zu einer falsch ausgerichteten (aber unbemerkt bleibenden) Section fuehren
    -- fail loudly statt stiller Verlust."""

    def load_align_model(language_code, device):
        return object(), {}

    platzhalter = types.ModuleType("whisperx")
    platzhalter.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", platzhalter)

    lines = ["eins zwei"]  # nur zwei Woerter
    # bis_index nennt fuenf Woerter -- passt nicht zur tatsaechlichen Wortzahl.
    abschnitte = [Abschnitt(0, 5, 0.0, 5.0, 1.0, False)]
    with pytest.raises(AlignmentFailed):
        align(Path("egal.wav"), lines, "de", tmp_path, "hashMismatch", "cpu", [], abschnitte)
