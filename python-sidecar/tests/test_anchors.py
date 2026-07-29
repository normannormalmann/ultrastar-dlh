import pytest

from ultrastar_pipeline.anchors import (
    MAX_WOERTER_PRO_SEKUNDE,
    Anchor,
    GemessenesWort,
    berechne_anker,
    finde_anker,
    normalisiere,
)
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
    """Die Raender folgen der Evidenz, nicht der Spur: das erste Fenster
    beginnt beim ersten Anker (hier zufaellig 0,0, kein Vorlauf noetig), das
    letzte endet beim letzten Anker plus Saum und Nachlauf fuer das letzte
    verankerte Wort selbst - nicht am Spurende."""
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(40)]
    abschnitte = baue_abschnitte(40, anker, dauer_s=50.0, zielgroesse=12, saum_s=0.3)

    assert abschnitte[0].start_s == 0.0
    assert abschnitte[-1].ende_s == pytest.approx(40.3)
    for vorher, nachher in zip(abschnitte, abschnitte[1:]):
        # Ueberlappung als Sicherheitssaum ist gewollt, eine Luecke nicht.
        assert nachher.start_s <= vorher.ende_s


def test_vertrauen_ist_der_anteil_verankerter_woerter_im_abschnitt():
    # 20 Woerter, aber nur die erste Haelfte ist verankert.
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(10)]
    abschnitte = baue_abschnitte(20, anker, dauer_s=30.0, zielgroesse=5)

    assert abschnitte[0].vertrauen > abschnitte[-1].vertrauen
    assert all(0.0 <= a.vertrauen <= 1.0 for a in abschnitte)


def test_ein_einziger_anker_ergibt_einen_abschnitt_ohne_verankerte_raender():
    """Ein einzelner Anker kann keine Grenze zwischen zwei Abschnitten sein.
    Es bleibt ein Abschnitt, dessen beide Raender am Spurrand liegen."""
    abschnitte = baue_abschnitte(10, [Anchor(bekannter_index=0, zeit=2.0)], dauer_s=20.0)
    assert len(abschnitte) == 1
    assert abschnitte[0].beidseitig_verankert is False


def test_songlaenge_vor_dem_letzten_zeitstempel_wird_abgelehnt():
    """Beide Zeitquellen muessen zusammenpassen. Tun sie es nicht, entstuenden
    umgedrehte Fenster \u2014 das darf nicht still passieren."""
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(5)]
    with pytest.raises(ValueError, match="widerspruechlich"):
        baue_abschnitte(10, anker, dauer_s=2.0)


def test_nicht_positive_songlaenge_wird_abgelehnt():
    with pytest.raises(ValueError, match="positiv"):
        baue_abschnitte(10, [], dauer_s=0.0)


def test_verhoerter_erster_refrain_verwechselt_die_wiederholung_nicht():
    """Der Fehlerfall des Pilotlaufs, verkleinert: der erste Refrain wurde
    teils verhoert, der letzte sauber erkannt. Ein Matcher, der den laengsten
    Block zuerst bindet, haengt den Text-Anfangsrefrain an die spaete
    Wiederholung — und die gesamte Mitte verliert ihre Anker."""
    refrain = ["glocke", "klingt", "heute", "wieder", "hell"]
    strophe = [f"wort{i}" for i in range(20)]
    bekannte = [*refrain, *strophe, *refrain]
    gehoert = (
        ["glocke", "klingelt", "heute", "wieder", "hell"]
        + [w if i % 2 == 0 else f"anders{i}" for i, w in enumerate(strophe)]
        + refrain
    )
    anker = finde_anker(bekannte, _gehoert(gehoert))

    indizes = [a.bekannter_index for a in anker]
    # Die klar gehoerten Strophenwoerter muessen verankert sein.
    assert len([i for i in indizes if 5 <= i < 25]) >= 8
    # Und der erste Refrain haengt vorn, nicht am Songende.
    fruehe = [a.zeit for a in anker if a.bekannter_index in (0, 2, 3, 4)]
    assert fruehe and max(fruehe) < 10.0


def test_rand_fenster_klemmen_an_die_anker_nicht_an_die_spur():
    """Ein langes Intro oder Outro gehoert nicht ins Fenster: es gibt dem
    Aligner nur Raum, die Woerter dorthin zu verschieben (gemessen: erste
    Strophe 12 s zu spaet). Die Raender folgen der Evidenz, nicht der Spur."""
    anker = [Anchor(bekannter_index=i, zeit=50.0 + i) for i in range(10)]
    abschnitte = baue_abschnitte(10, anker, dauer_s=300.0)
    # Erster Anker bei 50 s, kein unverankertes Wort davor: 50 - Saum.
    assert abschnitte[0].start_s == pytest.approx(49.7)
    # Letzter Anker bei 59 s, keins danach: 59 + Saum + 1 s fuer das Wort selbst.
    assert abschnitte[-1].ende_s == pytest.approx(60.3)


def test_unverankerte_randwoerter_bekommen_vorlauf():
    """Unverankerte Woerter vor dem ersten Anker werden trotzdem gesungen -
    das Fenster muss ihnen Zeit einraeumen, eine Sekunde je Wort."""
    anker = [Anchor(bekannter_index=4, zeit=50.0), Anchor(bekannter_index=5, zeit=51.0)]
    abschnitte = baue_abschnitte(10, anker, dauer_s=300.0)
    assert len(abschnitte) == 1  # zwei Anker im Abstand 1 ergeben keine Grenze
    # 4 unverankerte davor: 50 - 0.3 - 4 * 1.0
    assert abschnitte[0].start_s == pytest.approx(45.7)
    # 4 unverankerte danach (Indizes 6-9) plus das verankerte Wort selbst:
    # 51 + 0.3 + 5 * 1.0
    assert abschnitte[0].ende_s == pytest.approx(56.3)


def test_falsch_anker_grenze_faellt_statt_woerter_zu_quetschen():
    """Ein Falsch-Anker (Fuellwort in einem ASR-Loch) darf keine Section
    erzwingen, in der niemand singen kann. Gemessen im Pilot: 58 Woerter in
    4,3 s. Die Grenze muss fallen, die Woerter gehen im Nachbarn auf."""
    anker = [Anchor(0, 10.0), Anchor(12, 20.0), Anchor(70, 24.0)]
    abschnitte = baue_abschnitte(80, anker, dauer_s=120.0)
    for a in abschnitte:
        rate = (a.bis_index - a.von_index) / max(a.ende_s - a.start_s, 0.01)
        assert rate <= MAX_WOERTER_PRO_SEKUNDE


def _gehoert_berechne(texte_und_zeiten: list[tuple[str, float, float, float]]) -> list[TranskriptWort]:
    return [
        TranskriptWort(text=t, start=s, ende=e, score=sc)
        for t, s, e, sc in texte_und_zeiten
    ]


def test_exakte_anker_tragen_gemessene_zeit_und_quelle():
    gehoerte = _gehoert_berechne([("Hallo", 10.0, 10.4, 0.8), ("Welt", 10.5, 10.9, 0.2)])
    anker = berechne_anker(["hallo", "welt"], gehoerte)
    assert anker == [
        GemessenesWort(10.0, 10.4, 0.8, "anchor"),
        GemessenesWort(10.5, 10.9, 0.2, "anchor"),
    ]


def test_unerkannte_woerter_bleiben_none():
    gehoerte = _gehoert_berechne([("eins", 1.0, 1.2, 0.9)])
    anker = berechne_anker(["eins", "zwei", "drei"], gehoerte)
    assert anker[0] is not None
    assert anker[1] is None and anker[2] is None


def test_fuzzy_anker_fangen_abweichende_schreibweise():
    """Das akustische Ereignis ist dasselbe, nur die Schreibweise weicht ab
    ("is" gehoert, "ist" im Text) — der gemessene Zeitstempel ist gut und
    darf nicht verloren gehen, nur weil die exakte LCS ihn nicht matcht."""
    gehoerte = _gehoert_berechne([
        ("gestern", 1.0, 1.3, 0.7),
        ("is", 1.4, 1.5, 0.4),
        ("morgen", 1.6, 2.0, 0.6),
    ])
    anker = berechne_anker(["gestern", "ist", "morgen"], gehoerte)
    assert anker[1] == GemessenesWort(1.4, 1.5, 0.4, "fuzzy")


def test_fuzzy_paart_monoton_nicht_kreuzweise():
    """Zwei aehnliche Woerter in einer Luecke: die DP-Paarung muss in beiden
    Folgen vorwaerts laufen, sonst bekaeme ein spaetes Textwort die Zeit
    eines fruehen Ereignisses."""
    gehoerte = _gehoert_berechne([
        ("anfang", 0.0, 0.4, 0.9),
        ("laufen", 1.0, 1.4, 0.5),
        ("singen", 2.0, 2.4, 0.5),
        ("schluss", 3.0, 3.4, 0.9),
    ])
    anker = berechne_anker(["anfang", "laufe", "singe", "schluss"], gehoerte)
    assert anker[1] == GemessenesWort(1.0, 1.4, 0.5, "fuzzy")
    assert anker[2] == GemessenesWort(2.0, 2.4, 0.5, "fuzzy")


def test_voellig_verschiedene_woerter_bekommen_keinen_fuzzy_anker():
    gehoerte = _gehoert_berechne([
        ("anfang", 0.0, 0.4, 0.9),
        ("xylophon", 1.0, 1.4, 0.5),
        ("schluss", 3.0, 3.4, 0.9),
    ])
    anker = berechne_anker(["anfang", "regen", "schluss"], gehoerte)
    assert anker[1] is None


def test_ziffern_tokens_liefern_nie_einen_anker():
    """Das wav2vec2-Vokabular enthaelt keine Ziffern: der Zeitstempel eines
    "17"-Tokens ist erfunden. Ein solcher Anker waere schlimmer als keiner,
    weil er Interpolation und Fenstergrenzen vergiftet."""
    gehoerte = _gehoert_berechne([
        ("anfang", 0.0, 0.4, 0.9),
        ("17", 1.0, 1.1, 0.9),
        ("schluss", 3.0, 3.4, 0.9),
    ])
    anker = berechne_anker(["anfang", "17", "schluss"], gehoerte)
    assert anker[1] is None


def test_kurzes_isoliertes_wort_mit_schwachem_score_wird_entlarvt():
    """Ein "in" mitten in einem grossen ASR-Loch mit Score < 0,3 ist eher
    die falsche Vorkommnis als eine Messung — im Pilot erzeugte genau so
    ein Falsch-Anker eine Section mit 13,6 Woertern/s."""
    gehoerte = _gehoert_berechne([("in", 50.0, 50.1, 0.1)])
    bekannte = ["a", "b", "c", "in", "d", "e", "f"]
    anker = berechne_anker(bekannte, gehoerte)
    assert all(a is None for a in anker)


def test_kurzes_isoliertes_wort_mit_gutem_score_bleibt():
    gehoerte = _gehoert_berechne([("in", 50.0, 50.1, 0.6)])
    bekannte = ["a", "b", "c", "in", "d", "e", "f"]
    anker = berechne_anker(bekannte, gehoerte)
    assert anker[3] == GemessenesWort(50.0, 50.1, 0.6, "anchor")


def test_kurzes_wort_mit_gemessenem_nachbarn_bleibt():
    gehoerte = _gehoert_berechne([("in", 50.0, 50.1, 0.1), ("haus", 50.2, 50.6, 0.4)])
    bekannte = ["a", "b", "c", "in", "haus", "e", "f"]
    anker = berechne_anker(bekannte, gehoerte)
    assert anker[3] is not None


def test_leere_eingaben_ergeben_nur_none():
    assert berechne_anker([], []) == []
    assert berechne_anker(["wort"], []) == [None]
