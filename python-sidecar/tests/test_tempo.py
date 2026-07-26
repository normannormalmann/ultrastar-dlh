import pytest

from ultrastar_pipeline.tempo import korrigiere_tempo


@pytest.mark.parametrize(
    "eingabe,erwartet",
    [
        (120.0, 120.0),  # schon im Zielbereich
        (60.0, 120.0),   # zu langsam -> verdoppeln
        (35.0, 140.0),   # zweimal verdoppeln
        (300.0, 150.0),  # zu schnell -> halbieren
        (600.0, 150.0),  # zweimal halbieren
        (200.0, 100.0),  # knapp ueber max -> halbieren
    ],
)
def test_korrigiert_halb_und_doppel(eingabe, erwartet):
    assert korrigiere_tempo(eingabe) == pytest.approx(erwartet)


def test_bricht_bei_unsinnigem_wert_nicht_endlos():
    assert korrigiere_tempo(0.0) == 0.0
    assert korrigiere_tempo(-5.0) == -5.0
