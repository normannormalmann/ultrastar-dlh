from ultrastar_pipeline.anchors import Anchor, finde_anker, normalisiere
from ultrastar_pipeline.transcribe import TranskriptWort


def _gehoert(woerter: list[str], schritt: float = 1.0) -> list[TranskriptWort]:
    return [
        TranskriptWort(text=w, start=i * schritt, ende=(i + 1) * schritt)
        for i, w in enumerate(woerter)
    ]


def test_normalisierung_entfernt_schreibweise_satzzeichen_und_diakritika():
    assert normalisiere("Cafe!") == "cafe"
    assert normalisiere("HALLO") == "hallo"
    assert normalisiere("wort,") == "wort"
    assert normalisiere("—") == ""


def test_identische_folgen_ergeben_einen_anker_je_wort():
    bekannte = ["eins", "zwei", "drei"]
    anker = finde_anker(bekannte, _gehoert(bekannte))
    assert [a.bekannter_index for a in anker] == [0, 1, 2]
    assert [a.zeit for a in anker] == [0.0, 1.0, 2.0]


def test_verhoertes_wort_faellt_heraus_ohne_die_nachbarn_zu_verlieren():
    bekannte = ["eins", "zwei", "drei"]
    anker = finde_anker(bekannte, _gehoert(["eins", "zwo", "drei"]))
    indizes = [a.bekannter_index for a in anker]
    assert 0 in indizes and 2 in indizes
    assert 1 not in indizes


def test_doppelter_refrain_ergibt_monotone_anker_ohne_rueckwaertssprung():
    """Der Test, der beim bisherigen Verfahren fehlgeschlagen waere: eine
    Refrainwiederholung darf nicht mit der frueheren verwechselt werden."""
    refrain = ["licht", "an", "heute"]
    bekannte = [*refrain, "strophe", *refrain]
    anker = finde_anker(bekannte, _gehoert([*refrain, "strophe", *refrain]))

    indizes = [a.bekannter_index for a in anker]
    zeiten = [a.zeit for a in anker]
    assert indizes == sorted(indizes) and len(set(indizes)) == len(indizes)
    assert zeiten == sorted(zeiten)
    # Der zweite Refrain muss spaet liegen, nicht auf die Zeit des ersten.
    spaete = [a.zeit for a in anker if a.bekannter_index >= 4]
    assert spaete and min(spaete) >= 4.0


def test_leeres_transkript_ergibt_keine_anker():
    assert finde_anker(["eins", "zwei"], []) == []


def test_leerer_liedtext_ergibt_keine_anker():
    assert finde_anker([], _gehoert(["eins"])) == []


def test_anker_sind_in_beiden_dimensionen_streng_steigend():
    """Die tragende Invariante des gesamten Entwurfs."""
    bekannte = ["a", "b", "c", "d", "e", "f", "a", "b", "c"]
    anker = finde_anker(bekannte, _gehoert(["a", "x", "c", "d", "e", "f", "a", "b", "c"]))
    for vorher, nachher in zip(anker, anker[1:]):
        assert nachher.bekannter_index > vorher.bekannter_index
        assert nachher.zeit > vorher.zeit
