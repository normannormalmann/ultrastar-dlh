from ultrastar_pipeline.contract import SCHEMA_VERSION, baue_song_data
from ultrastar_pipeline.notes import LineBreak, Note


def _baue(noten, umbrueche=()):
    return baue_song_data(
        bpm=120.0,
        gap=1000,
        language="de",
        notes=list(noten),
        line_breaks=list(umbrueche),
        duration_sec=10.0,
        device="cpu",
        stage_versions={},
        warnings=[],
    )


def test_enthaelt_schema_version():
    assert _baue([Note(0, 4, 5, "Hal", 0.9)])["schemaVersion"] == SCHEMA_VERSION == 2


def test_notenfelder_heissen_wie_im_vertrag():
    d = _baue([Note(1, 2, 3, "Sil", 0.8)], [LineBreak(0, 8)])
    assert d["notes"][0] == {
        "beat": 1,
        "length": 2,
        "pitch": 3,
        "syllable": "Sil",
        "confidence": 0.8,
    }
    assert d["lineBreaks"][0] == {"afterNoteIndex": 0, "beat": 8}


def test_konfidenz_wird_aggregiert_und_markiert():
    d = _baue([Note(i, 2, 3, "x", 0.2) for i in range(5)])
    assert d["meta"]["confidence"]["median"] == 0.2
    assert d["meta"]["confidence"]["unsureRatio"] == 1.0
    assert d["meta"]["lowConfidence"] is True


def test_hohe_konfidenz_ist_nicht_markiert():
    d = _baue([Note(i, 2, 3, "x", 0.95) for i in range(5)])
    assert d["meta"]["lowConfidence"] is False
    assert d["meta"]["confidence"]["unsureRatio"] == 0.0


def test_leere_notenliste_wirft_nicht_und_gilt_nicht_als_unsicher():
    d = _baue([])
    assert d["notes"] == []
    assert d["meta"]["lowConfidence"] is False


def test_fehlende_sections_ergibt_leere_liste():
    d = _baue([Note(0, 4, 5, "Hal", 0.9)])
    assert d["sections"] == []


def test_sections_werden_unveraendert_uebernommen():
    eintrag = {
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "confidence": 0.75,
        "anchoredBothSides": True,
    }
    d = baue_song_data(
        bpm=120.0,
        gap=1000,
        language="de",
        notes=[Note(0, 4, 5, "Hal", 0.9)],
        line_breaks=[],
        duration_sec=10.0,
        device="cpu",
        stage_versions={},
        warnings=[],
        sections=[eintrag],
    )
    assert d["sections"] == [eintrag]
