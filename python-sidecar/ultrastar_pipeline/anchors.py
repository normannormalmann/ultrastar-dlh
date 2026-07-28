"""Anker zwischen bekanntem Liedtext und gehoertem Transkript.

Rein: kein Audio, kein Modell, keine Nebenwirkung. Hier liegt die
Entscheidungslogik des Alignments, und nur deshalb ist sie ohne GPU pruefbar.
"""

import unicodedata
from dataclasses import dataclass

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

    Echte laengste gemeinsame Teilfolge per dynamischer Programmierung —
    global optimal. Der fruehere greedy Ansatz (difflib, laengster Block
    zuerst) band im Pilotlauf einen wortgleich wiederholten Refrain an die
    falsche Stelle und liess 80 Woerter ohne Anker; einer global optimalen
    Teilfolge kann das nicht passieren, weil die geopferten Treffer der
    Mitte jede solche Zuordnung vom Maximum wegdruecken. Die Monotonie in
    beiden Indizes folgt aus der Konstruktion. O(n*m) ist bei
    Liedtextgroessen (einige hundert Woerter) unkritisch.

    Voraussetzung: `gehoerte` ist zeitlich aufsteigend sortiert.
    """
    if not bekannte or not gehoerte:
        return []

    a = [normalisiere(w) for w in bekannte]
    b = [normalisiere(w.text) for w in gehoerte]
    n, m = len(a), len(b)

    # folge[i][j] = Laenge der laengsten gemeinsamen Teilfolge von a[i:], b[j:].
    # Woerter, die nach der Normalisierung leer sind (reine Satzzeichen),
    # matchen nie — sie liefern keine Zeit und gehoeren nicht verankert.
    folge = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        zeile, naechste, ai = folge[i], folge[i + 1], a[i]
        for j in range(m - 1, -1, -1):
            if ai and ai == b[j]:
                zeile[j] = naechste[j + 1] + 1
            else:
                zeile[j] = naechste[j] if naechste[j] >= zeile[j + 1] else zeile[j + 1]

    anker: list[Anchor] = []
    i = j = 0
    while i < n and j < m:
        if a[i] and a[i] == b[j]:
            anker.append(Anchor(bekannter_index=i, zeit=gehoerte[j].start))
            i += 1
            j += 1
        elif folge[i + 1][j] >= folge[i][j + 1]:
            i += 1
        else:
            j += 1
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


# Schnellster echter Abschnitt im Pilotkorpus (dichter Rap): 6,9 Woerter/s.
# Was darueber liegt, singt niemand — eine solche Grenze stammt von einem
# Falsch-Anker (z. B. ein Fuellwort, das zufaellig in einem ASR-Loch matcht).
MAX_WOERTER_PRO_SEKUNDE = 8.0


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

    verankerte_indizes = {a.bekannter_index for a in anker}

    def _schneide(grenzen: list[Anchor]) -> list[Abschnitt]:
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

    # Grenzanker im Zielabstand auswaehlen, immer beim ersten beginnend.
    grenzen = [anker[0]]
    for a in anker[1:]:
        if a.bekannter_index - grenzen[-1].bekannter_index >= zielgroesse:
            grenzen.append(a)

    abschnitte = _schneide(grenzen)

    # Eine Grenze, die eine unsingbare Rate erzwingt, ist ein Falsch-Anker.
    # Sie faellt, und der Abschnitt geht in dem Nachbarn auf, der die
    # niedrigere Rate ergibt. Terminiert, weil jede Runde eine Grenze
    # entfernt. Faellt die letzte Grenze, bleibt der eine Abschnitt ueber
    # die volle Spur — der bekannte, sichtbare Rueckfall.
    def _rate(a: Abschnitt) -> float:
        return (a.bis_index - a.von_index) / max(a.ende_s - a.start_s, 1e-9)

    while len(grenzen) > 1:
        verdaechtig = next(
            (k for k, a in enumerate(abschnitte) if _rate(a) > MAX_WOERTER_PRO_SEKUNDE),
            None,
        )
        if verdaechtig is None:
            break
        # Kandidaten: die Grenze am Anfang des Abschnitts (merge nach vorn)
        # oder die an seinem Ende (merge nach hinten) — es gewinnt der
        # Nachbar mit der niedrigeren resultierenden Rate.
        kandidaten = []
        if verdaechtig > 0:
            kandidaten.append(grenzen[:verdaechtig] + grenzen[verdaechtig + 1 :])
        if verdaechtig < len(grenzen) - 1:
            kandidaten.append(grenzen[: verdaechtig + 1] + grenzen[verdaechtig + 2 :])
        grenzen = min(
            kandidaten,
            key=lambda g: max((_rate(a) for a in _schneide(g)), default=0.0),
        )
        abschnitte = _schneide(grenzen)

    return abschnitte
