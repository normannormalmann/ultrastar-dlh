"""Anker zwischen bekanntem Liedtext und gehoertem Transkript.

Rein: kein Audio, kein Modell, keine Nebenwirkung. Hier liegt die
Entscheidungslogik des Alignments, und nur deshalb ist sie ohne GPU pruefbar.

Teile portiert aus UltraStarKaraokeMaker (https://github.com/walterfr/UltraStarKaraokeMaker, MIT, (c) walterfr).
"""

import difflib
import unicodedata
from dataclasses import dataclass

from .transcribe import TranskriptWort


@dataclass(frozen=True)
class Anchor:
    """Ein bekanntes Wort und die Zeit, zu der es gehoert wurde."""

    bekannter_index: int
    zeit: float


# Zeitquellen, von der verlaesslichsten zur unsichersten. Die Strings sind
# Vertragsbestandteil (sections/Diagnose) und aendern sich nicht.
QUELLE_EXAKT = "anchor"
QUELLE_FUZZY = "fuzzy"
QUELLE_REALIGN = "realign"
QUELLE_LRC = "lrc"
QUELLE_INTERPOLIERT = "interpolated"


@dataclass(frozen=True)
class GemessenesWort:
    """Gemessene Zeit eines bekannten Wortes samt Herkunft der Messung."""

    start: float
    ende: float
    score: float
    quelle: str


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


def _lcs_paare(a: list[str], b: list[str]) -> list[tuple[int, int]]:
    """Indexpaare der echten laengsten gemeinsamen Teilfolge (DP, global
    optimal, monoton in beiden Folgen). Leere Strings matchen nie - sie
    tragen keine Information und gehoeren nicht gepaart. Warum echte LCS
    statt greedy difflib: siehe finde_anker (der greedy Ansatz band einen
    wiederholten Refrain an die falsche Stelle)."""
    n, m = len(a), len(b)
    folge = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        zeile, naechste, ai = folge[i], folge[i + 1], a[i]
        for j in range(m - 1, -1, -1):
            if ai and ai == b[j]:
                zeile[j] = naechste[j + 1] + 1
            else:
                zeile[j] = naechste[j] if naechste[j] >= zeile[j + 1] else zeile[j + 1]
    paare: list[tuple[int, int]] = []
    i = j = 0
    while i < n and j < m:
        if a[i] and a[i] == b[j]:
            paare.append((i, j))
            i += 1
            j += 1
        elif folge[i + 1][j] >= folge[i][j + 1]:
            i += 1
        else:
            j += 1
    return paare


def _falte_akzente(wort: str) -> str:
    """Nur fuer den Fuzzy-Vergleich: Akzente falten, damit Schreibvarianten
    desselben Klangs zusammenfinden. Der exakte Vergleich nutzt weiterhin
    normalisiere() (die faltet ebenfalls - hier geht es um die rohe Form
    fuer die Zeichenaehnlichkeit)."""
    zerlegt = unicodedata.normalize("NFKD", wort)
    return "".join(z for z in zerlegt if not unicodedata.combining(z))


def _hat_ziffer(text: str) -> bool:
    return any(z.isdigit() for z in text)


def _fuzzy_paare(
    gehoert_block: list[str],
    bekannt_block: list[str],
    schwelle: float = 0.6,
) -> list[tuple[int, int]]:
    """Monotone DP-Paarung fast-gleicher Woerter (Zeichenaehnlichkeit auf
    akzentgefalteten Formen), maximiert die Summe der Aehnlichkeiten ueber
    der Schwelle. difflib.ratio() dient hier nur als Zeichenaehnlichkeit
    zweier kurzer Strings - nicht als Sequenz-Matcher ueber den Song, wo
    der greedy Ansatz nachweislich versagt hat.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    n, m = len(gehoert_block), len(bekannt_block)
    if n == 0 or m == 0 or n * m > 250_000:
        return []

    gehoert_gefaltet = [_falte_akzente(w) for w in gehoert_block]
    bekannt_gefaltet = [_falte_akzente(w) for w in bekannt_block]

    aehnlich = [[0.0] * m for _ in range(n)]
    for i, a in enumerate(gehoert_gefaltet):
        if not a:
            continue
        for j, b in enumerate(bekannt_gefaltet):
            if not b:
                continue
            r = difflib.SequenceMatcher(None, a, b).ratio()
            if r >= schwelle:
                aehnlich[i][j] = r

    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            beste = max(dp[i + 1][j], dp[i][j + 1])
            if aehnlich[i][j] > 0.0:
                beste = max(beste, aehnlich[i][j] + dp[i + 1][j + 1])
            dp[i][j] = beste

    paare: list[tuple[int, int]] = []
    i = j = 0
    while i < n and j < m:
        if aehnlich[i][j] > 0.0 and abs(dp[i][j] - (aehnlich[i][j] + dp[i + 1][j + 1])) < 1e-9:
            paare.append((i, j))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return paare


def _entlarve_verdaechtige(
    anker: list[GemessenesWort | None],
    bekannt_norm: list[str],
    mindest_isolation: int = 3,
    score_boden: float = 0.3,
) -> None:
    """Kurze exakte Anker (<= 2 Zeichen), isoliert in grossen Luecken und
    mit schwachem Score, sind eher die falsche Vorkommnis als eine Messung.
    Ein falscher Anker vergiftet Interpolation und Fenstergrenzen - keiner
    ist billiger. Der Score-Boden schuetzt isolierte, aber selbstbewusste
    Messungen vor dem Verwurf (im Vorbild als echter Bug gemessen)."""
    n = len(anker)
    for j in range(n):
        a = anker[j]
        if a is None or a.quelle != QUELLE_EXAKT or len(bekannt_norm[j]) > 2:
            continue
        if a.score >= score_boden:
            continue
        if (j > 0 and anker[j - 1] is not None) or (j + 1 < n and anker[j + 1] is not None):
            continue
        davor = 0
        k = j - 1
        while k >= 0 and anker[k] is None:
            davor += 1
            k -= 1
        danach = 0
        k = j + 1
        while k < n and anker[k] is None:
            danach += 1
            k += 1
        if davor >= mindest_isolation and danach >= mindest_isolation:
            anker[j] = None


def berechne_anker(
    bekannte: list[str], gehoerte: list[TranskriptWort]
) -> list[GemessenesWort | None]:
    """Paesse 1 und 2: exakte Anker (echte LCS) plus Fuzzy-Anker in den
    Luecken dazwischen, danach die Misstrauensregeln. Liste parallel zu
    `bekannte`; None heisst: keine gemessene Zeit fuer dieses Wort.

    Zahlen werden hier bewusst NICHT ausgeschrieben: im Vorbild gemessen
    verlaengert das nur ambige Refrain-Bloecke und kostet Anker. Zahlen
    behandelt das Fenster-Alignment (Pass 3), das zwischen zwei gemessenen
    Nachbarn eingesperrt ist und nicht wegdriften kann.

    Voraussetzung: `gehoerte` ist zeitlich aufsteigend sortiert.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    anker: list[GemessenesWort | None] = [None] * len(bekannte)
    if not bekannte or not gehoerte:
        return anker

    bekannt_norm = [normalisiere(w) for w in bekannte]
    gehoert_norm = [normalisiere(w.text) for w in gehoerte]

    paare = _lcs_paare(bekannt_norm, gehoert_norm)
    for bi, gi in paare:
        w = gehoerte[gi]
        if _hat_ziffer(w.text):
            continue
        anker[bi] = GemessenesWort(w.start, w.ende, w.score, QUELLE_EXAKT)

    # Pass 2: die Luecken zwischen benachbarten exakten Treffern. Nur wo
    # BEIDE Seiten Woerter uebrig haben, hat der ASR dort etwas gehoert -
    # das entspricht den "replace"-Bloecken des Vorbilds.
    grenzen = [(-1, -1)] + [(bi, gi) for bi, gi in paare] + [(len(bekannte), len(gehoerte))]
    for (b0, g0), (b1, g1) in zip(grenzen, grenzen[1:]):
        bekannt_indizes = list(range(b0 + 1, b1))
        gehoert_indizes = list(range(g0 + 1, g1))
        if not bekannt_indizes or not gehoert_indizes:
            continue
        for gi_off, bi_off in _fuzzy_paare(
            [gehoert_norm[k] for k in gehoert_indizes],
            [bekannt_norm[k] for k in bekannt_indizes],
        ):
            w = gehoerte[gehoert_indizes[gi_off]]
            if _hat_ziffer(w.text):
                continue
            anker[bekannt_indizes[bi_off]] = GemessenesWort(
                w.start, w.ende, w.score, QUELLE_FUZZY
            )

    _entlarve_verdaechtige(anker, bekannt_norm)
    return anker


def finde_anker(bekannte: list[str], gehoerte: list[TranskriptWort]) -> list[Anchor]:
    """Ordnet bekannte Woerter den Zeiten gehoerter Woerter zu.

    Echte laengste gemeinsame Teilfolge per dynamischer Programmierung -
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
    return [
        Anchor(bekannter_index=i, zeit=gehoerte[j].start) for i, j in _lcs_paare(a, b)
    ]


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

# Vorlauf fuer unverankerte Woerter am Rand. Der Median im Pilot lag bei
# 1,2-1,35 Woertern/s; eine Sekunde je Wort ist grosszuegig, ohne dem
# Aligner wieder ein halbes Intro zu schenken.
RAND_SEKUNDEN_JE_WORT = 1.0


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

    Die aeusseren Raender reichen nicht bis an den Spurrand, sondern klemmen
    an den ersten bzw. letzten Anker (mit Vorlauf fuer unverankerte Randwoerter):
    ein langes Intro oder Outro gehoert nicht ins Fenster, es gibt dem Aligner
    sonst nur Raum, Woerter dorthin zu verschieben.

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
            if i == 0:
                # Das Fenster folgt der Evidenz, nicht der Spur: ein Intro gibt
                # dem Aligner nur Raum, die Woerter dorthin zu verschieben.
                # Unverankerte Woerter vor dem ersten Anker bekommen Vorlauf.
                vorlauf = anker[0].bekannter_index * RAND_SEKUNDEN_JE_WORT
                start = max(0.0, anker[0].zeit - saum_s - vorlauf)
            else:
                start = max(0.0, grenze.zeit - saum_s)
            if letzter:
                # Die Ankerzeit ist der Wortanfang - das letzte verankerte Wort
                # braucht selbst noch Raum, dazu die unverankerten danach.
                nachlauf = (
                    anzahl_woerter - anker[-1].bekannter_index
                ) * RAND_SEKUNDEN_JE_WORT
                ende = min(dauer_s, anker[-1].zeit + saum_s + nachlauf)
            else:
                ende = min(dauer_s, grenzen[i + 1].zeit + saum_s)

            spanne = max(1, bis - von)
            getroffen = sum(1 for idx in range(von, bis) if idx in verankerte_indizes)
            abschnitte.append(
                Abschnitt(
                    von_index=von,
                    bis_index=bis,
                    start_s=start,
                    ende_s=ende,
                    vertrauen=getroffen / spanne,
                    # Erster und letzter Abschnitt sind an ihrem Aussenrand aus
                    # einem einzelnen Anker (plus Vorlauf/Nachlauf) extrapoliert,
                    # nicht von einer zweiten Grenze gehalten wie innen.
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
