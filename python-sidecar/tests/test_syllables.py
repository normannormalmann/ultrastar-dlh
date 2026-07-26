from ultrastar_pipeline.syllables import has_dictionary, split_syllables


def test_zerlegt_deutsches_wort():
    assert split_syllables("Hallo", "de") == ["Hal", "lo"]


def test_behaelt_kurzes_wort_ganz():
    assert split_syllables("Welt", "de") == ["Welt"]


def test_silben_ergeben_wieder_das_wort():
    for wort in ["Hallo", "Wiedersehen", "Liebe", "understanding"]:
        for sprache in ["de", "en"]:
            assert "".join(split_syllables(wort, sprache)) == wort


def test_faellt_bei_unbekannter_sprache_auf_ganzes_wort_zurueck():
    assert split_syllables("Hallo", "xx-nicht-existent") == ["Hallo"]
    assert has_dictionary("xx-nicht-existent") is False


def test_leeres_wort_ergibt_leere_liste():
    assert split_syllables("", "de") == []
