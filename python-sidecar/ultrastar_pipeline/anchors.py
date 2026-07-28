"""Anker zwischen bekanntem Liedtext und gehoertem Transkript.

Rein: kein Audio, kein Modell, keine Nebenwirkung. Hier liegt die
Entscheidungslogik des Alignments, und nur deshalb ist sie ohne GPU pruefbar.
"""

import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from .transcribe import TranskriptWort


@dataclass(frozen=True)
class Anchor:
    """Ein bekanntes Wort und die Zeit, zu der es gehoert wurde."""

    bekannter_index: int
    zeit: float


def normalisiere(wort: str) -> str:
    """Vergleichsform eines Wortes: ohne Schreibweise, Diakritika, Satzzeichen.

    Ausschliesslich fuer den Vergleich. Der Ausgabetext bleibt immer der
    Quelltext — Forced Alignment gibt den gelieferten Text unveraendert
    zurueck (gemessen: 156 von 156 Tokens byte-identisch), und diese
    Eigenschaft wird nicht aufgegeben.
    """
    zerlegt = unicodedata.normalize("NFKD", wort.casefold())
    ohne_marken = "".join(z for z in zerlegt if not unicodedata.combining(z))
    return "".join(z for z in ohne_marken if z.isalnum())


def finde_anker(bekannte: list[str], gehoerte: list[TranskriptWort]) -> list[Anchor]:
    """Ordnet bekannte Woerter den Zeiten gehoerter Woerter zu.

    Grundlage ist die laengste gemeinsame Teilfolge. Deren Monotonie ist die
    tragende Eigenschaft: sie verbietet strukturell, dass eine
    Refrainwiederholung mit einer frueheren verwechselt wird. Ein verhoertes
    Wort faellt aus der Teilfolge heraus, ohne seine Nachbarn mitzureissen.
    """
    if not bekannte or not gehoerte:
        return []

    a = [normalisiere(w) for w in bekannte]
    b = [normalisiere(w.text) for w in gehoerte]

    anker: list[Anchor] = []
    # autojunk verwirft haeufige Elemente als "unbedeutend" — bei Liedtext
    # sind genau die haeufigen Woerter aber oft die einzigen sicheren Treffer.
    for block in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
        for versatz in range(block.size):
            index = block.a + versatz
            if not a[index]:  # rein aus Satzzeichen bestehend, kein Anker
                continue
            anker.append(
                Anchor(bekannter_index=index, zeit=gehoerte[block.b + versatz].start)
            )
    return anker
