from ultrastar_pipeline.numerals import erweitere_tokens, erweitere_zahlwort


def test_zweistellige_zahl_wird_deutsch_ausgeschrieben():
    assert erweitere_zahlwort("20", "de") == ["zwanzig"]


def test_jahreszahl_wird_ausgeschrieben():
    # num2words liefert je nach Sprache ein oder mehrere Woerter -
    # entscheidend ist nur: keine Ziffern mehr, mindestens ein Wort.
    teile = erweitere_zahlwort("1985", "de")
    assert teile and all(not any(z.isdigit() for z in t) for t in teile)


def test_englisch_wird_unterstuetzt():
    assert erweitere_zahlwort("20", "en") == ["twenty"]


def test_nicht_zahlen_bleiben_unangetastet():
    assert erweitere_zahlwort("haus", "de") == ["haus"]
    assert erweitere_zahlwort("20jahre", "de") == ["20jahre"]


def test_zu_lange_ziffernfolge_bleibt_unangetastet():
    # Eine Telefonnummer singt niemand aus - konservativ nicht anfassen.
    assert erweitere_zahlwort("123456", "de") == ["123456"]


def test_unbekannte_sprache_faellt_auf_den_token_zurueck():
    assert erweitere_zahlwort("20", "zz") == ["20"]


def test_erweitere_tokens_liefert_herkunftsindizes():
    tokens, herkunft = erweitere_tokens(["nur", "20", "jahre"], "de")
    assert tokens == ["nur", "zwanzig", "jahre"]
    assert herkunft == [0, 1, 2]


def test_herkunft_zeigt_bei_expansion_mehrfach_auf_dasselbe_wort():
    tokens, herkunft = erweitere_tokens(["jahr", "21"], "en")
    assert tokens == ["jahr", "twenty", "one"]
    assert herkunft == [0, 1, 1]
