"""Zahlwort-Expansion fuer Vergleich und Forced Alignment.

Teile portiert aus UltraStarKaraokeMaker
(https://github.com/walterfr/UltraStarKaraokeMaker, MIT, (c) walterfr).

Der Liedtext schreibt Zahlen als Ziffern ("20"), gesungen wird "zwanzig".
Das bricht das Fenster-Alignment: das wav2vec2-Vokabular enthaelt keine
einzige Ziffer (im Vorbild nachgemessen), eine "20" kann dort mit keinem
Audio-Frame matchen und kollabiert zu einem erfundenen Zeitstempel.
Expandiert wird deshalb ausschliesslich fuer den Vergleich und den CTC -
der Text im Ergebnis bleibt immer der des Nutzers.
"""

import re

# num2words deckt die relevanten Sprachen ab; fehlt eine Sprache, ist der
# unveraenderte Token der ehrlichere Rueckfall als ein Abbruch: die
# Expansion ist eine Verbesserung des Alignments, keine Voraussetzung.
from num2words import num2words

_NUR_ZIFFERN = re.compile(r"^\d+$")

# Oberhalb davon ist "ausgeschrieben" fast sicher nicht das Gesungene
# (Jahreszahl ja, Telefonnummer nein) - konservativ nicht anfassen.
_MAX_ZIFFERN = 4

_zwischenspeicher: dict[tuple[str, str], list[str]] = {}


def erweitere_zahlwort(token: str, sprache: str) -> list[str]:
    """Reine Ziffernfolge ausgeschrieben als Wortliste, sonst [token]."""
    if not _NUR_ZIFFERN.match(token) or len(token) > _MAX_ZIFFERN:
        return [token]

    schluessel = (token, sprache)
    treffer = _zwischenspeicher.get(schluessel)
    if treffer is not None:
        return treffer

    try:
        ausgeschrieben = num2words(int(token), lang=sprache)
    except (NotImplementedError, OverflowError, ValueError):
        return [token]

    woerter = [w for w in re.split(r"[\s\-,]+", ausgeschrieben) if w]
    ergebnis = woerter or [token]
    _zwischenspeicher[schluessel] = ergebnis
    return ergebnis


def erweitere_tokens(tokens: list[str], sprache: str) -> tuple[list[str], list[int]]:
    """Expandierte Tokenliste plus Herkunft: herkunft[i] ist der Index des
    Ursprungstokens. Die Herkunft erlaubt es, gemessene Zeiten expandierter
    Tokens wieder auf das Ursprungswort zusammenzufassen."""
    aus: list[str] = []
    herkunft: list[int] = []
    for i, token in enumerate(tokens):
        for teil in erweitere_zahlwort(token, sprache):
            aus.append(teil)
            herkunft.append(i)
    return aus, herkunft
