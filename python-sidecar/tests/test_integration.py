# python-sidecar/tests/test_integration.py
"""Kette notes -> Vertrag, ohne Modelle. Laeuft in CI ohne GPU."""

import json
from pathlib import Path

from ultrastar_pipeline.contract import baue_song_data
from ultrastar_pipeline.notes import AlignedWord, PitchPoint, build_notes

FIXTURES = Path(__file__).parent / "fixtures"


def _lade():
    woerter = [
        AlignedWord(**w)
        for w in json.loads((FIXTURES / "align-kurz.json").read_text(encoding="utf8"))
    ]
    verlauf = [
        PitchPoint(**p)
        for p in json.loads((FIXTURES / "pitch-kurz.json").read_text(encoding="utf8"))
    ]
    return woerter, verlauf


def _baue():
    woerter, verlauf = _lade()
    noten, umbrueche, gap, _ = build_notes(woerter, verlauf, bpm=120.0, language="de")
    daten = baue_song_data(
        bpm=120.0,
        gap=gap,
        language="de",
        notes=noten,
        line_breaks=umbrueche,
        duration_sec=4.1,
        device="cpu",
        stage_versions={},
        warnings=[],
    )
    return noten, umbrueche, daten


def test_kette_erzeugt_vertragskonformes_json():
    _, _, daten = _baue()
    assert daten["schemaVersion"] == 2
    assert len(daten["notes"]) >= 4
    assert daten["gap"] == 1000
    assert daten["meta"]["lowConfidence"] is False


def test_zeilenumbruch_zwischen_den_beiden_zeilen():
    noten, umbrueche, _ = _baue()
    assert len(umbrueche) == 1
    assert 0 <= umbrueche[0].after_note_index < len(noten) - 1


def test_beats_sind_aufsteigend():
    noten, _, _ = _baue()
    beats = [n.beat for n in noten]
    assert beats == sorted(beats)


def test_json_ist_serialisierbar(tmp_path):
    _, _, daten = _baue()
    ziel = tmp_path / "song_data.json"
    ziel.write_text(json.dumps(daten, ensure_ascii=False, indent=2), encoding="utf8")
    assert json.loads(ziel.read_text(encoding="utf8"))["bpm"] == 120.0
