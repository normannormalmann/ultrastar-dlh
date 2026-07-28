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
    # Escape statt Literalzeichen: der Quelltext bleibt ASCII, der NFKD-Pfad
    # wird trotzdem durchlaufen. e mit Akut ist ein vorkomponiertes Zeichen -
    # genau die Form, in der Diakritika in echtem Text stehen.
    assert normalisiere("Caf\u00e9") == "cafe"


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


from ultrastar_pipeline.anchors import Abschnitt, baue_abschnitte


def test_ohne_anker_entsteht_ein_abschnitt_ueber_die_ganze_spur():
    """Der wichtigste Fall ist der schlechteste: ohne Anker faellt das
    Verfahren auf das bisherige Verhalten zurueck \u2014 sichtbar, nicht still."""
    abschnitte = baue_abschnitte(anzahl_woerter=10, anker=[], dauer_s=100.0)
    assert len(abschnitte) == 1
    a = abschnitte[0]
    assert (a.von_index, a.bis_index) == (0, 10)
    assert (a.start_s, a.ende_s) == (0.0, 100.0)
    assert a.vertrauen == 0.0
    assert a.beidseitig_verankert is False


def test_abschnitte_decken_alle_woerter_lueckenlos_und_ueberschneidungsfrei_ab():
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(40)]
    abschnitte = baue_abschnitte(40, anker, dauer_s=40.0, zielgroesse=12)

    assert abschnitte[0].von_index == 0
    assert abschnitte[-1].bis_index == 40
    for vorher, nachher in zip(abschnitte, abschnitte[1:]):
        assert nachher.von_index == vorher.bis_index


def test_zeitfenster_sind_lueckenlos_und_die_raender_verankert():
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(40)]
    abschnitte = baue_abschnitte(40, anker, dauer_s=50.0, zielgroesse=12, saum_s=0.3)

    assert abschnitte[0].start_s == 0.0
    assert abschnitte[-1].ende_s == 50.0
    for vorher, nachher in zip(abschnitte, abschnitte[1:]):
        # Ueberlappung als Sicherheitssaum ist gewollt, eine Luecke nicht.
        assert nachher.start_s <= vorher.ende_s


def test_vertrauen_ist_der_anteil_verankerter_woerter_im_abschnitt():
    # 20 Woerter, aber nur die erste Haelfte ist verankert.
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(10)]
    abschnitte = baue_abschnitte(20, anker, dauer_s=30.0, zielgroesse=5)

    assert abschnitte[0].vertrauen > abschnitte[-1].vertrauen
    assert all(0.0 <= a.vertrauen <= 1.0 for a in abschnitte)


def test_ein_einziger_anker_ergibt_einen_einseitig_verankerten_abschnitt():
    abschnitte = baue_abschnitte(10, [Anchor(bekannter_index=0, zeit=2.0)], dauer_s=20.0)
    assert any(not a.beidseitig_verankert for a in abschnitte)
