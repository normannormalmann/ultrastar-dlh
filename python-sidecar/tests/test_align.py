from ultrastar_pipeline.align import zeilen_zuordnen
from ultrastar_pipeline.notes import AlignedWord


def w(text, i=0):
    """AlignedWord mit Platzhalter-Zeiten; line_index absichtlich falsch (99),
    damit ein Test wirklich prueft, dass zeilen_zuordnen ihn ueberschreibt."""
    return AlignedWord(text=text, start=float(i), end=float(i) + 0.5, confidence=0.9, line_index=99)


def test_exakte_zuordnung_ueber_mehrere_zeilen():
    lines = ["eins zwei", "drei", "vier fuenf sechs"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei", "drei", "vier", "fuenf", "sechs"])]
    ergebnis = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 0, 1, 2, 2, 2]
    # Text und Zeitwerte bleiben unveraendert, nur line_index wird ersetzt.
    assert [e.text for e in ergebnis] == [e.text for e in woerter]


def test_ueberzaehlige_woerter_fallen_an_die_letzte_zeile():
    lines = ["eins", "zwei"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei", "extra1", "extra2"])]
    ergebnis = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 1, 1, 1]


def test_fehlende_woerter_lassen_spaetere_zeilen_leer():
    lines = ["eins", "zwei", "drei"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei"])]
    ergebnis = zeilen_zuordnen(woerter, lines)
    # Nur zwei Woerter geliefert: die dritte Zeile bekommt nichts, statt dass
    # etwas erfunden wird.
    assert [e.line_index for e in ergebnis] == [0, 1]
    assert len(ergebnis) == 2


def test_einzelne_zeile_bekommt_alle_woerter():
    lines = ["ein einziges wort hier"]
    woerter = [w(t, i) for i, t in enumerate(["ein", "einziges", "wort", "hier"])]
    ergebnis = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 0, 0, 0]


def test_leere_wortliste_ergibt_leere_liste():
    assert zeilen_zuordnen([], ["eins", "zwei"]) == []
