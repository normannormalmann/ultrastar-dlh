import pytest

from ultrastar_pipeline.anchors import (
    GemessenesWort,
    berechne_anker,
    entlarve_mit_lrc,
    lese_lrc,
    normalisiere,
    ordne_lrc_zeilen,
    saee_lrc_anker,
    zeilen_startindizes,
)
from ultrastar_pipeline.transcribe import TranskriptWort


def _gehoert_berechne(texte_und_zeiten: list[tuple[str, float, float, float]]) -> list[TranskriptWort]:
    """Helfer fuer berechne_anker-Tests: Text, Start, Ende, Score."""
    return [
        TranskriptWort(text=text, start=start, ende=ende, score=score)
        for text, start, ende, score in texte_und_zeiten
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
    ("is" gehoert, "ist" im Text) - der gemessene Zeitstempel ist gut und
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
    die falsche Vorkommnis als eine Messung - im Pilot erzeugte genau so
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


def test_wiederholter_refrain_bindet_an_die_richtige_stelle():
    """Der greedy difflib-Ansatz band einen wortgleich wiederholten Refrain
    an die falsche Stelle und liess viele Woerter ohne Anker (gemessen im Pilot);
    die echte LCS kann das nicht, weil die geopferten Treffer der Mitte jede
    solche Zuordnung vom Maximum wegdruecken."""
    gehoerte = _gehoert_berechne([
        ("ref", 10.0, 10.3, 0.5),
        ("mitte", 20.0, 20.3, 0.5),
        ("ref", 30.0, 30.3, 0.5),
    ])
    anker = berechne_anker(["ref", "mitte", "ref"], gehoerte)
    assert anker[0] is not None and anker[0].start == 10.0
    assert anker[1] is not None and anker[1].start == 20.0
    assert anker[2] is not None and anker[2].start == 30.0


def test_lese_lrc_ignoriert_metadaten_und_sortiert():
    text = "\n".join([
        "[ar:Kuenstler]",
        "[00:45.50]zweite zeile",
        "[00:12.00]erste zeile",
        "[99:99]",
    ])
    assert lese_lrc(text) == [(12.0, "erste zeile"), (45.5, "zweite zeile")]


def test_lese_lrc_mehrere_zeitstempel_je_zeile():
    # Ein wiederholter Refrain steht im .lrc als eine Zeile mit mehreren
    # Zeitstempeln - jede Wiederholung ist ein eigener Pfosten.
    eintraege = lese_lrc("[00:10.00][01:10.00]refrain zeile\n")
    assert eintraege == [(10.0, "refrain zeile"), (70.0, "refrain zeile")]


def test_zeilen_startindizes_zaehlen_woerter_kumulativ():
    assert zeilen_startindizes(["a b c", "d e", "f"]) == [0, 3, 5]


def test_ordne_lrc_zeilen_matcht_nur_gleiche_zeilen():
    zeilen = ["hallo welt", "voellig anders", "gute nacht"]
    lrc = [(5.0, "Hallo Welt!"), (20.0, "etwas fremdes"), (30.0, "gute Nacht")]
    assert ordne_lrc_zeilen(zeilen, lrc) == [(0, 5.0), (4, 30.0)]


def test_saee_lrc_anker_fuellt_nur_luecken_monoton():
    anker: list = [None] * 6
    anker[0] = GemessenesWort(1.0, 1.3, 0.5, "anchor")
    # Pfosten bei Wort 2 (plausibel) und Wort 4 (vor dem Vorgaenger: unplausibel).
    pfosten = [(2, 5.0), (4, 0.5)]
    gesaeht = saee_lrc_anker(anker, pfosten)
    assert gesaeht == 1
    assert anker[2] == GemessenesWort(5.0, 5.25, 0.0, "lrc")
    assert anker[4] is None


def test_saee_lrc_anker_ueberschreibt_keine_messung():
    anker: list = [GemessenesWort(1.0, 1.3, 0.5, "anchor")]
    assert saee_lrc_anker(anker, [(0, 9.0)]) == 0
    assert anker[0].quelle == "anchor"


def test_saee_lrc_anker_kappt_das_ende_vor_dem_naechsten_gemessenen():
    anker: list = [None, GemessenesWort(5.1, 5.4, 0.5, "anchor")]
    saee_lrc_anker(anker, [(0, 5.0)])
    assert anker[0] is not None
    assert anker[0].ende <= 5.1 - 0.02 + 1e-9


def test_entlarve_mit_lrc_verwirft_weit_abweichende_messungen():
    """Ein zufaellig matchendes Fuellwort in einem ASR-Loch traegt eine
    Zeit, die zwischen den LRC-Pfosten nichts zu suchen hat (> 3 s von der
    interpolierten Erwartung) - genau der Falsch-Anker-Typ aus dem Pilot."""
    anker: list = [None] * 10
    anker[5] = GemessenesWort(50.0, 50.1, 0.9, "anchor")
    pfosten = [(0, 10.0), (9, 19.0)]  # erwartet bei Wort 5: 15.0
    entlarvt = entlarve_mit_lrc(anker, pfosten, audio_dauer=200.0)
    assert entlarvt == 1
    assert anker[5] is None


def test_entlarve_mit_lrc_laesst_plausible_messungen_stehen():
    anker: list = [None] * 10
    anker[5] = GemessenesWort(15.5, 15.8, 0.2, "anchor")
    pfosten = [(0, 10.0), (9, 19.0)]
    assert entlarve_mit_lrc(anker, pfosten, audio_dauer=200.0) == 0
    assert anker[5] is not None


def test_entlarve_mit_lrc_nutzt_das_songende_als_letzten_pfosten():
    """Woerter nach dem letzten Pfosten haetten sonst keinen Vergleichswert
    - genau dort (Schlusschor ueber dem Lead) braucht es die Pruefung am
    dringendsten. Das Audio-Ende schliesst das Loch."""
    anker: list = [None] * 10
    anker[8] = GemessenesWort(90.0, 90.2, 0.9, "anchor")
    pfosten = [(0, 10.0)]  # nur ein echter Pfosten am Anfang
    # Audio endet bei 20 s -> erwartet bei Wort 8: 18.0; 90.0 ist absurd.
    assert entlarve_mit_lrc(anker, pfosten, audio_dauer=20.0) == 1
    assert anker[8] is None


def test_entlarve_mit_lrc_ohne_genug_pfosten_tut_nichts():
    anker: list = [GemessenesWort(50.0, 50.1, 0.9, "anchor")]
    assert entlarve_mit_lrc(anker, [], audio_dauer=0.0) == 0
    assert anker[0] is not None
