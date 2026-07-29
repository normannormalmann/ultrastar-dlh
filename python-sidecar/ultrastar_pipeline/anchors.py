"""Anker zwischen bekanntem Liedtext und gehoertem Transkript.

Entscheidungslogik des Alignments, implementiert ohne Audio oder Modell und ohne
GPU-Anforderung. Pass 1-2 aus dem Vierpass-Modell (exakte und Fuzzy-Anker plus
Misstrauensregeln); Pass 3 und 4 leben in der Verarbeitungs-Pipeline danach.

Teile portiert aus UltraStarKaraokeMaker (https://github.com/walterfr/UltraStarKaraokeMaker, MIT, (c) walterfr).
"""

import difflib
import re
import unicodedata
from dataclasses import dataclass

from .transcribe import TranskriptWort


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
    statt greedy difflib: siehe berechne_anker (der greedy Ansatz band einen
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


_LRC_ZEITSTEMPEL = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")


def lese_lrc(text: str) -> list[tuple[float, str]]:
    """Synchronisierte Lyrics (.lrc, LRCLIB-Format) als sortierte Liste
    (Sekunden, Zeilentext). Metadatenzeilen ([ar:], [ti:], ...) haben kein
    Zeitstempel-Muster und fallen von selbst raus; eine Zeile mit mehreren
    Zeitstempeln (wiederholter Refrain) ergibt je Stempel einen Eintrag."""
    eintraege: list[tuple[float, str]] = []
    for zeile in text.splitlines():
        stempel = list(_LRC_ZEITSTEMPEL.finditer(zeile))
        if not stempel:
            continue
        inhalt = zeile[stempel[-1].end():].strip()
        if not inhalt:
            continue
        for m in stempel:
            minuten = int(m.group(1))
            sekunden = int(m.group(2))
            bruch = float(f"0.{m.group(3) or '0'}")
            eintraege.append((minuten * 60 + sekunden + bruch, inhalt))
    eintraege.sort(key=lambda e: e[0])
    return eintraege


def _normalisiere_zeile(zeile: str) -> str:
    """Vergleichsform einer ganzen Zeile: wortweise normalisiert, damit
    Satzzeichen und Schreibweise den Zeilenvergleich nicht stoeren."""
    teile = [normalisiere(w) for w in zeile.split()]
    return " ".join(t for t in teile if t)


def zeilen_startindizes(zeilen: list[str]) -> list[int]:
    """Index des ersten Wortes jeder Zeile in der flachen Wortliste -
    dieselbe Zerlegung (split je Zeile) wie beim Aufrufer, damit die
    Indizes zur flachen Liste passen."""
    indizes: list[int] = []
    lauf = 0
    for zeile in zeilen:
        indizes.append(lauf)
        lauf += len(zeile.split())
    return indizes


def ordne_lrc_zeilen(
    zeilen: list[str], lrc_zeilen: list[tuple[float, str]]
) -> list[tuple[int, float]]:
    """Pfosten aus dem .lrc: (Wortindex des Zeilenanfangs, Zeit). Zuordnung
    ueber echte LCS auf normalisierten Zeilentexten - nur exakt gleiche
    Zeilen zaehlen. Abweichend geschriebene Zeilen (andere Edition, andere
    Refrain-Schreibweise) bekommen schlicht keinen Pfosten, statt falsch
    zu matchen."""
    if not zeilen or not lrc_zeilen:
        return []
    a = [_normalisiere_zeile(z) for z in zeilen]
    b = [_normalisiere_zeile(t) for _, t in lrc_zeilen]
    starts = zeilen_startindizes(zeilen)
    return [(starts[zi], lrc_zeilen[li][0]) for zi, li in _lcs_paare(a, b)]


def entlarve_mit_lrc(
    anker: list[GemessenesWort | None],
    pfosten: list[tuple[int, float]],
    audio_dauer: float,
    toleranz: float = 3.0,
) -> int:
    """Verwirft gemessene Anker, die implausibel weit (> toleranz) von der
    linear interpolierten Erwartung zwischen zwei LRC-Pfosten liegen. Die
    Toleranz ist bewusst grob: der Zeilenanfang im .lrc hat selbst Spiel -
    das hier faengt nur Abweichungen, die kein Zufall mehr sind. Das
    Audio-Ende wirkt als synthetischer letzter Pfosten, sonst blieben
    Woerter nach dem letzten echten Pfosten ungeprueft (im Vorbild als
    realer blinder Fleck gemessen).

    Voraussetzung: `pfosten` ist nach Wortindex aufsteigend sortiert - das
    ist durch ordne_lrc_zeilen konstruktiv garantiert.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    n = len(anker)
    posts = [p for p in pfosten if p[0] < n]
    if audio_dauer > 0 and (not posts or audio_dauer > posts[-1][1]):
        posts = posts + [(n, audio_dauer)]
    if len(posts) < 2:
        return 0

    entlarvt = 0
    for i in range(n):
        a = anker[i]
        if a is None:
            continue
        davor: tuple[int, float] | None = None
        danach: tuple[int, float] | None = None
        for p_idx, p_zeit in posts:
            if p_idx <= i:
                davor = (p_idx, p_zeit)
            elif danach is None:
                danach = (p_idx, p_zeit)
                break
        if davor is None or danach is None or danach[0] <= davor[0]:
            continue
        anteil = (i - davor[0]) / (danach[0] - davor[0])
        erwartet = davor[1] + anteil * (danach[1] - davor[1])
        if abs(a.start - erwartet) > toleranz:
            anker[i] = None
            entlarvt += 1
    return entlarvt


def saee_lrc_anker(
    anker: list[GemessenesWort | None],
    pfosten: list[tuple[int, float]],
    toleranz: float = 0.6,
) -> int:
    """Saet Zeilenanfangs-Anker in Luecken, die der ASR nicht gemessen hat.
    Gemessene Anker haben Vorrang (praeziser als ein Zeilenanfang); der
    Wert des .lrc liegt genau in den ASR-Loechern - kuerzere Interpolation,
    bessere Fenstergrenzen fuer Pass 3. Monotonie gegen die gemessenen
    Nachbarn wird geprueft, sonst wuerde ein Pfosten einer anderen Edition
    die Reihenfolge brechen: gegen den Vorgaenger mit Toleranz (eine leicht
    fruehe Saat bricht die Startreihenfolge nicht), gegen den Nachfolger
    dagegen streng (echte Gleichheit oder Ueberholen wird verworfen).

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    n = len(anker)
    gesaeht = 0
    for wortindex, zeit in pfosten:
        if wortindex >= n or anker[wortindex] is not None:
            continue
        vor_ende: float | None = None
        for k in range(wortindex - 1, -1, -1):
            if anker[k] is not None:
                vor_ende = anker[k].ende
                break
        nach_start: float | None = None
        for k in range(wortindex + 1, n):
            if anker[k] is not None:
                nach_start = anker[k].start
                break
        if vor_ende is not None and zeit < vor_ende - toleranz:
            continue
        # Streng gegen den Nachfolger: Toleranz hier wuerde die Saat hinter
        # den gemessenen Nachfolger-Start setzen und die Interpolation
        # danach rueckwaerts laufen lassen.
        if nach_start is not None and zeit >= nach_start:
            continue
        ende = zeit + 0.25
        if nach_start is not None:
            ende = min(ende, max(zeit + 0.02, nach_start - 0.02))
        anker[wortindex] = GemessenesWort(zeit, ende, 0.0, QUELLE_LRC)
        gesaeht += 1
    return gesaeht
