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

    Der Algorithmus findet uebereinstimmende Wortfolgen mit SequenceMatcher
    (Ratcliff/Obershelp). Die tragende Eigenschaft ist die Monotonie:
    get_matching_blocks() gibt Bloecke mit streng steigenden Indizes zurueck,
    womit strukturell verhindert wird, dass eine Refrainwiederholung mit
    einer frueheren verwechselt wird. Ein verhoertes Wort faellt aus der
    Teilfolge heraus, ohne seine Nachbarn mitzureissen.

    Voraussetzung: `gehoerte` ist zeitlich aufsteigend sortiert.
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


@dataclass(frozen=True)
class Abschnitt:
    """Ein Textausschnitt mit dem Zeitfenster, in dem er gesungen wird.

    bis_index ist exklusiv. vertrauen ist der Anteil der Woerter des
    Abschnitts, die im Transkript wiedergefunden wurden.
    """

    von_index: int
    bis_index: int
    start_s: float
    ende_s: float
    vertrauen: float
    beidseitig_verankert: bool


def baue_abschnitte(
    anzahl_woerter: int,
    anker: list[Anchor],
    dauer_s: float,
    zielgroesse: int = 12,
    saum_s: float = 0.3,
) -> list[Abschnitt]:
    """Schneidet den Liedtext an tragfaehigen Ankern in Abschnitte.

    Nicht jeder Anker wird zur Grenze: zu enge Fenster nehmen dem Aligner den
    Spielraum, den er braucht. Grenzen entstehen im Abstand von etwa
    zielgroesse Woertern.

    Ohne Anker entsteht genau ein Abschnitt ueber die volle Spur \u2014 bitweise
    das bisherige Verhalten. Das Verfahren kann damit nie schlechter werden
    als der gemessene Basiswert, sondern hoechstens sichtbar darauf
    zurueckfallen.
    """
    # Zwei Zeitquellen muessen zusammenpassen: die Ankerzeiten stammen aus dem
    # Transkript, dauer_s aus der Audiodatei. Passen sie nicht zusammen, waeren
    # alle Fenster falsch - und der Deckel weiter unten wuerde daraus lautlos
    # umgedrehte Fenster machen (Start nach Ende). Lieber hier abbrechen.
    if dauer_s <= 0.0:
        raise ValueError(f"Songlaenge muss positiv sein, war {dauer_s}")
    if anker and dauer_s < anker[-1].zeit:
        raise ValueError(
            f"Songlaenge {dauer_s}s liegt vor dem letzten Zeitstempel "
            f"{anker[-1].zeit}s - widerspruechlich"
        )
    if anzahl_woerter <= 0:
        return []
    if not anker:
        return [
            Abschnitt(0, anzahl_woerter, 0.0, dauer_s, 0.0, beidseitig_verankert=False)
        ]

    # Grenzanker im Zielabstand auswaehlen, immer beim ersten beginnend.
    grenzen: list[Anchor] = [anker[0]]
    for a in anker[1:]:
        if a.bekannter_index - grenzen[-1].bekannter_index >= zielgroesse:
            grenzen.append(a)

    verankerte_indizes = {a.bekannter_index for a in anker}
    abschnitte: list[Abschnitt] = []
    for i, grenze in enumerate(grenzen):
        letzter = i == len(grenzen) - 1
        von = 0 if i == 0 else grenze.bekannter_index
        bis = anzahl_woerter if letzter else grenzen[i + 1].bekannter_index
        start = 0.0 if i == 0 else max(0.0, grenze.zeit - saum_s)
        ende = dauer_s if letzter else min(dauer_s, grenzen[i + 1].zeit + saum_s)

        spanne = max(1, bis - von)
        getroffen = sum(1 for idx in range(von, bis) if idx in verankerte_indizes)
        abschnitte.append(
            Abschnitt(
                von_index=von,
                bis_index=bis,
                start_s=start,
                ende_s=ende,
                vertrauen=getroffen / spanne,
                # Erster und letzter Abschnitt reichen bis an den Rand der
                # Spur und sind dort nicht von einem Anker begrenzt.
                beidseitig_verankert=not (i == 0 or letzter),
            )
        )
    return abschnitte
