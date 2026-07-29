# Vierpass-Alignment + LRCLIB Implementation Plan (Teilprojekt 1c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Alignment auf das Vierpass-Modell umstellen (gemessene Anker, Fuzzy-Anker, Fenster-Alignment der Luecken, gewichtete Interpolation) plus LRCLIB-Zeilenanker als zweite Evidenzquelle.

**Architecture:** `transcribe` liefert kuenftig *gemessene* Wortzeiten (Forced Alignment des eigenen Transkripts). `anchors.py` wird zu reiner Anker-Logik (LCS-exakt, Fuzzy, Misstrauen, LRC-Saeen/-Entlarven) mit einem Anker-oder-None je Textwort. `align.py` wird zu Pass 3+4 (Fenster-Alignment nur fuer unverankerte Laeufe, Interpolation als letzter Rueckfall). Sections im Vertrag beschreiben Laeufe gleicher Messbarkeit. Spec: `docs/superpowers/specs/2026-07-29-alignment-vierpass-design.md`. Vorbild: UltraStarKaraokeMaker (MIT, (c) walterfr) — lokaler Klon unter `C:/Users/norma/AppData/Local/Temp/claude/C--Users-norma-Documents-Codeprojekte-UltraStar-CLI/b3b777fd-559b-4449-a2ba-21bf6cca6fc0/scratchpad/UltraStarKaraokeMaker/`.

**Tech Stack:** Python 3.12 (whisperx, numpy, num2words), TypeScript/Bun (Effect), pytest, bun test.

## Global Constraints

- Worktree: `C:/Users/norma/Documents/Codeprojekte/UltraStar-CLI-pipeline-core`, Branch `feat/alignment-anker`. Nicht wechseln.
- Python-Interpreter immer `python-sidecar/.venv312/Scripts/python.exe`; pytest aus `python-sidecar/` aufrufen: `.venv312/Scripts/python.exe -m pytest -q`.
- TypeScript: `bun test src` und `bunx tsc --noEmit` muessen sauber sein.
- Python-Quelltext: Deutsch ohne Umlaute, reines ASCII (Sonderzeichen als Unicode-Escapes), LF-Zeilenenden. Formpruefung je Task: keine CRLF, keine neuen Nicht-ASCII-Zeichen in geaenderten .py-Dateien.
- TypeScript-Kommentare: Deutsch in ASCII-Schreibweise wie im Bestand ("fuer", "ueber").
- Docstrings/Kommentare erklaeren das *Warum*, nicht das Was.
- Fail loudly. Stille Rueckfaelle nur die von der Spec benannten: Fenster-Alignment -> Interpolation (mit Warnung), fehlende/unpassende .lrc -> weiter ohne LRC, LRCLIB-Fehlschlag -> `null`.
- Tests niemals gegen echte Modelle, GPU oder Netz: `whisperx` als Platzhalter-Modul via `monkeypatch.setitem(sys.modules, "whisperx", ...)`, HTTP via injizierte `fetchFn`.
- Niemals Songtexte oder Transkript-Ausschnitte in Berichte, Commits oder Warnungen — nur Zahlen. Testdaten mit erfundenen Woertern sind erlaubt.
- Quellen-Strings im Vertrag exakt: `"anchor"`, `"fuzzy"`, `"realign"`, `"lrc"`, `"interpolated"`.
- Der wav2vec-Score ist Anzeige, nie Verwurfskriterium. Einzige Ausnahme: die Misstrauensregel (Score < 0,3 UND isoliert UND <= 2 Zeichen), die die Spec ausdruecklich vorsieht.
- Portierte Logik traegt im Dateikopf: `Teile portiert aus UltraStarKaraokeMaker (https://github.com/walterfr/UltraStarKaraokeMaker, MIT, (c) walterfr).` Lizenztext liegt unter `docs/third-party/UltraStarKaraokeMaker-LICENSE`.
- Schema bleibt Version 2; `sections` aendert nur seine Semantik (Laeufe gleicher Messbarkeit), nicht seine Form.

---

### Task 1: numerals.py — Zahlwort-Expansion fuer den CTC

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/numerals.py`
- Create: `python-sidecar/tests/test_numerals.py`
- Create: `docs/third-party/UltraStarKaraokeMaker-LICENSE`
- Modify: `python-sidecar/pyproject.toml` (Dependency `num2words`)

**Interfaces:**
- Produces: `erweitere_zahlwort(token: str, sprache: str) -> list[str]` und `erweitere_tokens(tokens: list[str], sprache: str) -> tuple[list[str], list[int]]` — spaeter von `align.py` (Task 5/6) konsumiert.

- [ ] **Step 1: Lizenztext und Dependency**

```bash
mkdir -p docs/third-party
cp "C:/Users/norma/AppData/Local/Temp/claude/C--Users-norma-Documents-Codeprojekte-UltraStar-CLI/b3b777fd-559b-4449-a2ba-21bf6cca6fc0/scratchpad/UltraStarKaraokeMaker/LICENSE" docs/third-party/UltraStarKaraokeMaker-LICENSE
```

In `python-sidecar/pyproject.toml` die Hauptabhaengigkeit ergaenzen (num2words ist reines Python, gehoert nicht in die models-Extras — auch reine Tests brauchen es):

```toml
dependencies = ["num2words>=0.5"]
```

Dann installieren (aus `python-sidecar/`):

```bash
uv pip install --python .venv312/Scripts/python.exe num2words
```

- [ ] **Step 2: Failing Tests schreiben** — `python-sidecar/tests/test_numerals.py`:

```python
from ultrastar_pipeline.numerals import erweitere_tokens, erweitere_zahlwort


def test_zweistellige_zahl_wird_deutsch_ausgeschrieben():
    assert erweitere_zahlwort("20", "de") == ["zwanzig"]


def test_jahreszahl_wird_ausgeschrieben():
    # num2words liefert je nach Sprache ein oder mehrere Woerter —
    # entscheidend ist nur: keine Ziffern mehr, mindestens ein Wort.
    teile = erweitere_zahlwort("1985", "de")
    assert teile and all(not any(z.isdigit() for z in t) for t in teile)


def test_englisch_wird_unterstuetzt():
    assert erweitere_zahlwort("20", "en") == ["twenty"]


def test_nicht_zahlen_bleiben_unangetastet():
    assert erweitere_zahlwort("haus", "de") == ["haus"]
    assert erweitere_zahlwort("20jahre", "de") == ["20jahre"]


def test_zu_lange_ziffernfolge_bleibt_unangetastet():
    # Eine Telefonnummer singt niemand aus — konservativ nicht anfassen.
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
```

- [ ] **Step 3: Fehlschlag belegen**

Run (aus `python-sidecar/`): `.venv312/Scripts/python.exe -m pytest tests/test_numerals.py -v`
Expected: FAIL mit `ModuleNotFoundError: No module named 'ultrastar_pipeline.numerals'`

- [ ] **Step 4: Implementierung** — `python-sidecar/ultrastar_pipeline/numerals.py`:

```python
"""Zahlwort-Expansion fuer Vergleich und Forced Alignment.

Teile portiert aus UltraStarKaraokeMaker
(https://github.com/walterfr/UltraStarKaraokeMaker, MIT, (c) walterfr).

Der Liedtext schreibt Zahlen als Ziffern ("20"), gesungen wird "zwanzig".
Das bricht das Fenster-Alignment: das wav2vec2-Vokabular enthaelt keine
einzige Ziffer (im Vorbild nachgemessen), eine "20" kann dort mit keinem
Audio-Frame matchen und kollabiert zu einem erfundenen Zeitstempel.
Expandiert wird deshalb ausschliesslich fuer den Vergleich und den CTC —
der Text im Ergebnis bleibt immer der des Nutzers.
"""

import re

# num2words deckt die relevanten Sprachen ab; fehlt eine Sprache, ist der
# unveraenderte Token der ehrlichere Rueckfall als ein Abbruch: die
# Expansion ist eine Verbesserung des Alignments, keine Voraussetzung.
from num2words import num2words

_NUR_ZIFFERN = re.compile(r"^\d+$")

# Oberhalb davon ist "ausgeschrieben" fast sicher nicht das Gesungene
# (Jahreszahl ja, Telefonnummer nein) — konservativ nicht anfassen.
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
```

- [ ] **Step 5: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_numerals.py -v` — alle PASS.
Run: `.venv312/Scripts/python.exe -m pytest -q` — keine Regression.
Formpruefung: keine CRLF, keine Nicht-ASCII-Zeichen in beiden neuen .py-Dateien.

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/numerals.py python-sidecar/tests/test_numerals.py python-sidecar/pyproject.toml docs/third-party/UltraStarKaraokeMaker-LICENSE
git commit -m "feat(sidecar): numeral expansion for CTC alignment"
```

---

### Task 2: transcribe.py v2 — gemessene Transkript-Zeiten

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/transcribe.py`
- Modify: `python-sidecar/tests/test_transcribe.py`

**Interfaces:**
- Produces: `TranskriptWort(text: str, start: float, ende: float, score: float = 0.0)` (frozen dataclass) — `anchors.py` (Task 3) liest `start`, `ende`, `score`. `STAGE_VERSION = "2"`.

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `tests/test_transcribe.py`:

```python
def _stub_mit_alignment() -> types.ModuleType:
    """whisperx-Platzhalter: Transkription plus Forced Alignment des
    Transkripts, ohne ein Modell zu laden."""
    modul = types.ModuleType("whisperx")

    class _Modell:
        def transcribe(self, pfad, language):
            return {"segments": [{"text": "hallo welt kaputt", "start": 0.0, "end": 2.0}]}

    modul.load_model = lambda *a, **k: _Modell()
    modul.load_align_model = lambda **k: ("alignmodell", {"meta": True})

    def align(segmente, modell, metadaten, pfad, device, return_char_alignments):
        return {
            "segments": [
                {"words": [
                    {"word": "hallo", "start": 10.2, "end": 10.6, "score": 0.31},
                    {"word": "welt", "start": 10.7, "end": 11.1},
                    {"word": "kaputt", "start": None, "end": None},
                ]}
            ]
        }

    modul.align = align
    return modul


def test_transkript_zeiten_sind_gemessen_nicht_verteilt(tmp_path, monkeypatch):
    """Die gleichverteilten Segmentzeiten des alten Verfahrens lagen im
    Pilot bis 4 s daneben (erster Anker geschaetzt 6,4 s, gesungen 10,5 s).
    Jetzt kommen die Zeiten aus dem Forced Alignment des Transkripts —
    Woerter ohne Zeitstempel entfallen, ein erfundener Wert waere schlimmer
    als ein fehlendes Wort."""
    monkeypatch.setitem(sys.modules, "whisperx", _stub_mit_alignment())
    ergebnis = transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashD", "cpu")
    assert ergebnis == [
        TranskriptWort(text="hallo", start=10.2, ende=10.6, score=0.31),
        TranskriptWort(text="welt", start=10.7, ende=11.1, score=0.0),
    ]


def test_score_ueberlebt_den_cache(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "whisperx", _stub_mit_alignment())
    transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashE", "cpu")

    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    ergebnis = transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashE", "cpu")
    assert zugriffe == []
    assert ergebnis[0].score == 0.31


def test_fehlendes_alignment_modell_nennt_die_stufe_transcribe(tmp_path, monkeypatch):
    """Auch der zweite Modellzugriff dieser Stufe muss die Stufe nennen —
    sonst raet der Nutzer, ob ASR- oder Alignment-Modell fehlt."""
    modul = types.ModuleType("whisperx")

    class _Modell:
        def transcribe(self, pfad, language):
            return {"segments": []}

    modul.load_model = lambda *a, **k: _Modell()

    def load_align_model(**k):
        raise RuntimeError("kein Alignment-Modell")

    modul.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", modul)

    with pytest.raises(LanguageUnsupported) as fehler:
        transcribe.transcribe(Path("egal.wav"), "xy", tmp_path, "hashF", "cpu")
    assert fehler.value.stufe == "transcribe"
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_transcribe.py -v`
Expected: die drei neuen Tests FAILED (TranskriptWort kennt kein `score`; kein `load_align_model`-Aufruf), Bestand PASS.

- [ ] **Step 3: Implementierung** in `transcribe.py`:

1. `STAGE_VERSION = "2"` (neuer Cache-Schluessel; alte v1-Eintraege kollidieren nicht).
2. Dataclass erweitern:

```python
@dataclass(frozen=True)
class TranskriptWort:
    text: str
    start: float
    ende: float
    # Phonetischer Score des Forced Alignments. Bei Gesang systematisch
    # niedrig (0,0-0,35 auch bei korrekter Zeit) — Anzeige und
    # Misstrauensregel, nie Verwurfskriterium.
    score: float = 0.0
```

3. Den Block nach `ergebnis = modell.transcribe(...)` ersetzen — statt Segmentdauer gleichverteilen jetzt Forced Alignment des Transkripts:

```python
    # Pass 1 des Vierpass-Modells: das Transkript selbst wird ausgerichtet.
    # Die Segmentzeiten von Whisper sind Schaetzungen (gemessen: erster
    # Anker geschaetzt 6,4 s, gesungen 10,5 s); erst das Forced Alignment
    # macht aus gehoerten Woertern *gemessene* Zeiten.
    try:
        align_modell, metadaten = whisperx.load_align_model(
            language_code=sprache, device=device
        )
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc
    ausgerichtet = whisperx.align(
        ergebnis.get("segments", []),
        align_modell,
        metadaten,
        str(vocals),
        device,
        return_char_alignments=False,
    )

    woerter: list[TranskriptWort] = []
    for segment in ausgerichtet.get("segments", []):
        for wort in segment.get("words", []):
            # Ohne Zeitstempel kein Anker: ein erfundener Wert waere
            # schlimmer als ein fehlendes Wort.
            if wort.get("start") is None or wort.get("end") is None:
                continue
            text = str(wort.get("word", "")).strip()
            if not text:
                continue
            woerter.append(
                TranskriptWort(
                    text=text,
                    start=float(wort["start"]),
                    ende=float(wort["end"]),
                    score=float(wort.get("score", 0.0)),
                )
            )
```

4. Modul-Docstring anpassen (Zeiten sind gemessen, nicht verteilt). Der Cache-Write (`w.__dict__`) nimmt `score` automatisch mit.

- [ ] **Step 4: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_transcribe.py -v` — alle PASS.
Run: `.venv312/Scripts/python.exe -m pytest -q` — komplette Suite gruen.
Formpruefung wie in Task 1.

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/transcribe.py python-sidecar/tests/test_transcribe.py
git commit -m "feat(sidecar): transcribe v2 with measured word times"
```

---

### Task 3: anchors.py — berechne_anker (Pass 1 + 2 + Misstrauen)

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/anchors.py`
- Modify: `python-sidecar/tests/test_anchors.py`

**Interfaces:**
- Consumes: `TranskriptWort` mit `score` (Task 2).
- Produces: Konstanten `QUELLE_EXAKT = "anchor"`, `QUELLE_FUZZY = "fuzzy"`, `QUELLE_REALIGN = "realign"`, `QUELLE_LRC = "lrc"`, `QUELLE_INTERPOLIERT = "interpolated"`; frozen dataclass `GemessenesWort(start: float, ende: float, score: float, quelle: str)`; `berechne_anker(bekannte: list[str], gehoerte: list[TranskriptWort]) -> list[GemessenesWort | None]` (Liste parallel zu `bekannte`); Helfer `_lcs_paare(a: list[str], b: list[str]) -> list[tuple[int, int]]`. Konsumiert von Task 4 (LRC), Task 5/6 (align), Task 6 (`__main__`).
- Bestand bleibt in diesem Task unangetastet: `finde_anker`, `Anchor`, `Abschnitt`, `baue_abschnitte` (Entfernung erst Task 7, solange haengen `align.py` und `__main__.py` daran).

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `tests/test_anchors.py` (Import oben ergaenzen: `from ultrastar_pipeline.anchors import GemessenesWort, berechne_anker`):

```python
def _gehoert(texte_und_zeiten: list[tuple[str, float, float, float]]) -> list[TranskriptWort]:
    return [
        TranskriptWort(text=t, start=s, ende=e, score=sc)
        for t, s, e, sc in texte_und_zeiten
    ]


def test_exakte_anker_tragen_gemessene_zeit_und_quelle():
    gehoerte = _gehoert([("Hallo", 10.0, 10.4, 0.8), ("Welt", 10.5, 10.9, 0.2)])
    anker = berechne_anker(["hallo", "welt"], gehoerte)
    assert anker == [
        GemessenesWort(10.0, 10.4, 0.8, "anchor"),
        GemessenesWort(10.5, 10.9, 0.2, "anchor"),
    ]


def test_unerkannte_woerter_bleiben_none():
    gehoerte = _gehoert([("eins", 1.0, 1.2, 0.9)])
    anker = berechne_anker(["eins", "zwei", "drei"], gehoerte)
    assert anker[0] is not None
    assert anker[1] is None and anker[2] is None


def test_fuzzy_anker_fangen_abweichende_schreibweise():
    """Das akustische Ereignis ist dasselbe, nur die Schreibweise weicht ab
    ("is" gehoert, "ist" im Text) — der gemessene Zeitstempel ist gut und
    darf nicht verloren gehen, nur weil die exakte LCS ihn nicht matcht."""
    gehoerte = _gehoert([
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
    gehoerte = _gehoert([
        ("anfang", 0.0, 0.4, 0.9),
        ("laufen", 1.0, 1.4, 0.5),
        ("singen", 2.0, 2.4, 0.5),
        ("schluss", 3.0, 3.4, 0.9),
    ])
    anker = berechne_anker(["anfang", "laufe", "singe", "schluss"], gehoerte)
    assert anker[1] == GemessenesWort(1.0, 1.4, 0.5, "fuzzy")
    assert anker[2] == GemessenesWort(2.0, 2.4, 0.5, "fuzzy")


def test_voellig_verschiedene_woerter_bekommen_keinen_fuzzy_anker():
    gehoerte = _gehoert([
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
    gehoerte = _gehoert([
        ("anfang", 0.0, 0.4, 0.9),
        ("17", 1.0, 1.1, 0.9),
        ("schluss", 3.0, 3.4, 0.9),
    ])
    anker = berechne_anker(["anfang", "17", "schluss"], gehoerte)
    assert anker[1] is None


def test_kurzes_isoliertes_wort_mit_schwachem_score_wird_entlarvt():
    """Ein "in" mitten in einem grossen ASR-Loch mit Score < 0,3 ist eher
    die falsche Vorkommnis als eine Messung — im Pilot erzeugte genau so
    ein Falsch-Anker eine Section mit 13,6 Woertern/s."""
    gehoerte = _gehoert([("in", 50.0, 50.1, 0.1)])
    bekannte = ["a", "b", "c", "in", "d", "e", "f"]
    anker = berechne_anker(bekannte, gehoerte)
    assert all(a is None for a in anker)


def test_kurzes_isoliertes_wort_mit_gutem_score_bleibt():
    gehoerte = _gehoert([("in", 50.0, 50.1, 0.6)])
    bekannte = ["a", "b", "c", "in", "d", "e", "f"]
    anker = berechne_anker(bekannte, gehoerte)
    assert anker[3] == GemessenesWort(50.0, 50.1, 0.6, "anchor")


def test_kurzes_wort_mit_gemessenem_nachbarn_bleibt():
    gehoerte = _gehoert([("in", 50.0, 50.1, 0.1), ("haus", 50.2, 50.6, 0.4)])
    bekannte = ["a", "b", "c", "in", "haus", "e", "f"]
    anker = berechne_anker(bekannte, gehoerte)
    assert anker[3] is not None


def test_leere_eingaben_ergeben_nur_none():
    assert berechne_anker([], []) == []
    assert berechne_anker(["wort"], []) == [None]
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: neue Tests FAILED (`ImportError: cannot import name 'berechne_anker'`), Bestand PASS.

- [ ] **Step 3: Implementierung** in `anchors.py`. Dateikopf-Docstring um die Attributionszeile ergaenzen (siehe Global Constraints). Neue Bausteine (Bestand unangetastet lassen):

```python
import difflib

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
```

`_lcs_paare` als Verallgemeinerung der bestehenden `finde_anker`-DP (gleicher Algorithmus, gibt Indexpaare statt Anchor-Objekte zurueck):

```python
def _lcs_paare(a: list[str], b: list[str]) -> list[tuple[int, int]]:
    """Indexpaare der echten laengsten gemeinsamen Teilfolge (DP, global
    optimal, monoton in beiden Folgen). Leere Strings matchen nie — sie
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
```

Fuzzy-Paarung und Misstrauen (Portierung aus dem Vorbild, `_fuzzy_pairs` / `_demote_suspicious_anchors` in dessen `pipeline/align.py`):

```python
def _falte_akzente(wort: str) -> str:
    """Nur fuer den Fuzzy-Vergleich: Akzente falten, damit Schreibvarianten
    desselben Klangs zusammenfinden. Der exakte Vergleich nutzt weiterhin
    normalisiere() (die faltet ebenfalls — hier geht es um die rohe Form
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
    zweier kurzer Strings — nicht als Sequenz-Matcher ueber den Song, wo
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
    Ein falscher Anker vergiftet Interpolation und Fenstergrenzen — keiner
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
```

Hauptfunktion:

```python
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
    # BEIDE Seiten Woerter uebrig haben, hat der ASR dort etwas gehoert —
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
```

Zusaetzlich `finde_anker` intern auf `_lcs_paare` umstellen (gleiches Verhalten, eine DP-Implementierung statt zwei):

```python
def finde_anker(bekannte: list[str], gehoerte: list[TranskriptWort]) -> list[Anchor]:
    ...  # Docstring unveraendert
    if not bekannte or not gehoerte:
        return []
    a = [normalisiere(w) for w in bekannte]
    b = [normalisiere(w.text) for w in gehoerte]
    return [
        Anchor(bekannter_index=i, zeit=gehoerte[j].start) for i, j in _lcs_paare(a, b)
    ]
```

- [ ] **Step 4: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v` — alle PASS (neue und Bestand).
Run: `.venv312/Scripts/python.exe -m pytest -q` — komplette Suite gruen.
Formpruefung wie in Task 1.

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/anchors.py python-sidecar/tests/test_anchors.py
git commit -m "feat(sidecar): four-pass anchors with fuzzy matching and distrust rules"
```

---

### Task 4: anchors.py — LRC-Anker (Parsen, Zuordnen, Entlarven, Saeen)

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/anchors.py`
- Modify: `python-sidecar/tests/test_anchors.py`

**Interfaces:**
- Consumes: `GemessenesWort`, `QUELLE_LRC`, `_lcs_paare`, `normalisiere` (Task 3).
- Produces: `lese_lrc(text: str) -> list[tuple[float, str]]`; `zeilen_startindizes(zeilen: list[str]) -> list[int]`; `ordne_lrc_zeilen(zeilen: list[str], lrc_zeilen: list[tuple[float, str]]) -> list[tuple[int, float]]` (Pfosten: Wortindex des Zeilenanfangs, Zeit); `entlarve_mit_lrc(anker: list[GemessenesWort | None], pfosten: list[tuple[int, float]], audio_dauer: float, toleranz: float = 3.0) -> int`; `saee_lrc_anker(anker: list[GemessenesWort | None], pfosten: list[tuple[int, float]], toleranz: float = 0.6) -> int`. Beide mutieren `anker` in place und liefern die Anzahl geaenderter Eintraege. Konsumiert von `__main__.py` (Task 6).
- Reihenfolge beim Aufrufer: erst `entlarve_mit_lrc`, dann `saee_lrc_anker` (entlarvte Luecken sollen neu besaet werden koennen).

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `tests/test_anchors.py` (Imports ergaenzen: `entlarve_mit_lrc, lese_lrc, ordne_lrc_zeilen, saee_lrc_anker, zeilen_startindizes`):

```python
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
    # Zeitstempeln — jede Wiederholung ist ein eigener Pfosten.
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
    interpolierten Erwartung) — genau der Falsch-Anker-Typ aus dem Pilot."""
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
    — genau dort (Schlusschor ueber dem Lead) braucht es die Pruefung am
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
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: neue Tests FAILED (ImportError), Bestand PASS.

- [ ] **Step 3: Implementierung** in `anchors.py` (Portierung aus `pipeline/align.py` des Vorbilds: `parse_lrc`, `match_lrc_to_lines`, `seed_line_anchors`, `demote_anchors_conflicting_with_lrc`):

```python
import re

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
    """Index des ersten Wortes jeder Zeile in der flachen Wortliste —
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
    ueber echte LCS auf normalisierten Zeilentexten — nur exakt gleiche
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
    Toleranz ist bewusst grob: der Zeilenanfang im .lrc hat selbst Spiel —
    das hier faengt nur Abweichungen, die kein Zufall mehr sind. Das
    Audio-Ende wirkt als synthetischer letzter Pfosten, sonst blieben
    Woerter nach dem letzten echten Pfosten ungeprueft (im Vorbild als
    realer blinder Fleck gemessen).

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
    Wert des .lrc liegt genau in den ASR-Loechern — kuerzere Interpolation,
    bessere Fenstergrenzen fuer Pass 3. Monotonie gegen die gemessenen
    Nachbarn wird geprueft, sonst wuerde ein Pfosten einer anderen Edition
    die Reihenfolge brechen.

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
        if nach_start is not None and zeit > nach_start + toleranz:
            continue
        ende = zeit + 0.25
        if nach_start is not None:
            ende = min(ende, max(zeit + 0.02, nach_start - 0.02))
        anker[wortindex] = GemessenesWort(zeit, ende, 0.0, QUELLE_LRC)
        gesaeht += 1
    return gesaeht
```

Hinweis: `import re` steht danach neben `import unicodedata` am Dateikopf (nicht doppelt einfuegen, falls Task 3 es schon brauchte).

- [ ] **Step 4: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v` — alle PASS.
Run: `.venv312/Scripts/python.exe -m pytest -q` — komplette Suite gruen.
Formpruefung wie in Task 1.

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/anchors.py python-sidecar/tests/test_anchors.py
git commit -m "feat(sidecar): LRC line anchors (parse, match, demote, seed)"
```

---

### Task 5: align.py — reine Bausteine fuer Pass 3 und 4

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/align.py` (nur Ergaenzungen; `align()` selbst bleibt in diesem Task unveraendert)
- Modify: `python-sidecar/tests/test_align.py` (nur Ergaenzungen)

**Interfaces:**
- Consumes: `GemessenesWort`, `QUELLE_INTERPOLIERT` aus `anchors.py` (Task 3); `erweitere_zahlwort` aus `numerals.py` (Task 1).
- Produces (alles von Task 6 konsumiert):
  - `WortZeit(text: str, start: float, ende: float, score: float, quelle: str)` — bewusst veraenderliche dataclass (Pass 3 befoerdert Eintraege in place).
  - `silbengewicht(wort: str, sprache: str) -> int`
  - `interpoliere(anker: list[GemessenesWort | None], woerter: list[str], sprache: str, audio_ende: float) -> list[WortZeit]`
  - `stille_grenzen(audio, von_sample: int, bis_sample: int, abtastrate: int = 16000, energie_schwelle: float = 0.01, rahmen_ms: float = 20.0) -> tuple[int, int]`
  - `_ctc_tokens(wort: str, sprache: str) -> list[str]`
  - `_fasse_zusammen(roh: list[dict], herkunft: list[int], anzahl: int) -> list[dict] | None`
  - `_pruefe_fenster(woerter_roh: list[dict], fenster_start: float, fenster_ende: float) -> list[tuple[float, float, float]] | None`

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `tests/test_align.py` (Imports ergaenzen: `from ultrastar_pipeline.anchors import GemessenesWort` und die neuen Namen aus `ultrastar_pipeline.align`):

```python
def test_silbengewicht_zaehlt_vokalgruppen():
    assert silbengewicht("und", "de") == 1
    assert silbengewicht("melodie", "de") == 3
    # Akzentfaltung: Umlaute bleiben Vokale (ö -> o).
    assert silbengewicht("schön", "de") == 1


def test_silbengewicht_zaehlt_zahlen_wie_gesungen():
    # "20" hat keine Vokale und woege 1; gesungen wird "zwanzig" (2 Gruppen).
    assert silbengewicht("20", "de") == 2


def test_silbengewicht_ist_nie_null():
    assert silbengewicht("pst", "de") == 1


def _anker_liste(n: int, **feste) -> list:
    anker = [None] * n
    for i, wert in feste.items():
        anker[int(i[1:])] = wert
    return anker


def test_interpoliere_verteilt_nach_silbengewicht():
    """Luecke zwischen zwei Messungen: "melodie" (3 Gruppen) bekommt dreimal
    so viel Zeit wie "und" (1 Gruppe), und vor dem naechsten gemessenen
    Wort bleibt eine Atempause."""
    anker = [
        GemessenesWort(0.0, 1.0, 0.5, "anchor"),
        None,
        None,
        GemessenesWort(9.0, 9.5, 0.5, "anchor"),
    ]
    zeiten = interpoliere(anker, ["start", "und", "melodie", "ende"], "de", 20.0)
    assert [z.quelle for z in zeiten] == ["anchor", "interpolated", "interpolated", "anchor"]
    dauer_und = zeiten[1].ende - zeiten[1].start
    dauer_melodie = zeiten[2].ende - zeiten[2].start
    assert dauer_melodie == pytest.approx(3 * dauer_und)
    assert zeiten[1].start == pytest.approx(1.0)
    # Atempause: das letzte interpolierte Wort endet vor der Messung bei 9.0.
    assert zeiten[2].ende < 9.0
    assert all(z.score == 0.0 for z in zeiten[1:3])


def test_interpoliere_kette_am_ende_bleibt_im_audio():
    """Ohne Deckel liefe die Kette hinter das Songende (im Vorbild gemessen:
    163 Woerter bis 207,6 s bei 199 s Audio) — Noten nach dem Ende sind
    objektiver Muell."""
    anker = [GemessenesWort(9.0, 9.4, 0.5, "anchor")] + [None] * 20
    woerter = ["a"] + ["lalala"] * 20
    zeiten = interpoliere(anker, woerter, "de", 10.0)
    assert zeiten[-1].ende <= 10.0 + 1e-9


def test_interpoliere_kette_am_anfang_endet_an_der_ersten_messung():
    anker = [None, None, GemessenesWort(5.0, 5.4, 0.5, "anchor")]
    zeiten = interpoliere(anker, ["eins", "zwei", "drei"], "de", 20.0)
    assert zeiten[1].ende == pytest.approx(5.0)
    assert zeiten[0].start >= 0.0
    assert zeiten[0].ende == pytest.approx(zeiten[1].start)


def test_interpoliere_ohne_jeden_anker_beginnt_bei_null():
    zeiten = interpoliere([None, None], ["eins", "zwei"], "de", 100.0)
    assert zeiten[0].start == 0.0
    assert all(z.quelle == "interpolated" for z in zeiten)


def test_stille_grenzen_trimmt_raender():
    import numpy as np

    abtastrate = 16000
    rahmen = int(abtastrate * 0.02)
    stille = np.zeros(rahmen * 10, dtype=np.float32)
    ton = np.full(rahmen * 5, 0.5, dtype=np.float32)
    audio = np.concatenate([stille, ton, stille])
    von, bis = stille_grenzen(audio, 0, len(audio))
    # Ein Rahmen Vorlauf bleibt: der Konsonantenansatz hat weniger Energie
    # als der Vokal, gehoert aber zum Wort.
    assert von == rahmen * 9
    assert bis <= rahmen * 16


def test_stille_grenzen_ohne_energie_bleibt_unveraendert():
    import numpy as np

    audio = np.zeros(16000, dtype=np.float32)
    assert stille_grenzen(audio, 100, 8000) == (100, 8000)


def test_ctc_tokens_schreiben_zahlen_aus_und_lassen_rest_stehen():
    assert _ctc_tokens("20", "de") == ["zwanzig"]
    assert _ctc_tokens("Haus,", "de") == ["Haus,"]


def test_fasse_zusammen_vereinigt_expandierte_tokens():
    roh = [
        {"word": "twenty", "start": 1.0, "end": 1.4, "score": 0.5},
        {"word": "one", "start": 1.5, "end": 1.8, "score": 0.3},
    ]
    ergebnis = _fasse_zusammen(roh, [0, 0], 1)
    assert ergebnis is not None
    assert ergebnis[0]["start"] == 1.0
    assert ergebnis[0]["end"] == 1.8
    assert ergebnis[0]["score"] == 0.3


def test_fasse_zusammen_meldet_fehlende_zeitstempel():
    roh = [{"word": "x", "start": None, "end": None}]
    assert _fasse_zusammen(roh, [0], 1) is None


def test_pruefe_fenster_akzeptiert_monotone_zeiten_im_fenster():
    roh = [
        {"word": "a", "start": 1.0, "end": 1.2, "score": 0.4},
        {"word": "b", "start": 1.3, "end": 1.6, "score": 0.2},
    ]
    assert _pruefe_fenster(roh, 0.9, 2.0) == [(1.0, 1.2, 0.4), (1.3, 1.6, 0.2)]


def test_pruefe_fenster_verwirft_ausbrecher_und_rueckwaertslauf():
    ausserhalb = [{"word": "a", "start": 5.0, "end": 5.2, "score": 0.4}]
    assert _pruefe_fenster(ausserhalb, 0.9, 2.0) is None
    rueckwaerts = [
        {"word": "a", "start": 1.5, "end": 1.7, "score": 0.4},
        {"word": "b", "start": 1.0, "end": 1.2, "score": 0.4},
    ]
    assert _pruefe_fenster(rueckwaerts, 0.9, 2.0) is None
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_align.py -v`
Expected: neue Tests FAILED (ImportError), Bestand PASS.

- [ ] **Step 3: Implementierung** in `align.py`. Kopf-Docstring um die Attributionszeile ergaenzen. Imports: `import re`, `import unicodedata`, `from .anchors import GemessenesWort, QUELLE_INTERPOLIERT, QUELLE_REALIGN`, `from .numerals import erweitere_zahlwort` (der bestehende `from .anchors import Abschnitt` bleibt vorerst).

```python
@dataclass
class WortZeit:
    """Ein Textwort mit Zeit, Score und Herkunft der Zeit. Bewusst
    veraenderlich: Pass 3 befoerdert interpolierte Eintraege in place zu
    gemessenen."""

    text: str
    start: float
    ende: float
    score: float
    quelle: str


_VOKALGRUPPE = re.compile(r"[aeiouy]+")


def silbengewicht(wort: str, sprache: str) -> int:
    """Grobe Silbenzahl (Vokalgruppen) als Interpolationsgewicht — keine
    Silbentrennung, nur die Erkenntnis, dass "melodie" laenger klingt als
    "und". Akzente werden gefaltet (Umlaute bleiben Vokale), Zahlen zaehlen
    wie gesungen, nicht wie geschrieben ("20" hat keine Vokale, "zwanzig"
    zwei Gruppen). Mindestens 1."""
    zerlegt = unicodedata.normalize("NFKD", wort.casefold())
    gefaltet = "".join(z for z in zerlegt if not unicodedata.combining(z))
    kern = "".join(z for z in gefaltet if z.isalnum())
    ausgeschrieben = " ".join(erweitere_zahlwort(kern, sprache))
    return max(1, len(_VOKALGRUPPE.findall(ausgeschrieben)))


def interpoliere(
    anker: list[GemessenesWort | None],
    woerter: list[str],
    sprache: str,
    audio_ende: float,
) -> list[WortZeit]:
    """Pass 4, letzter Rueckfall: Woerter ohne Messung werden zwischen den
    gemessenen Nachbarn interpoliert, gewichtet nach geschaetzter
    Silbenzahl, mit einer Atempause vor der naechsten Messung. Ketten an
    den Raendern sind durch Audioanfang und -ende begrenzt (im Vorbild
    gemessen: ohne Deckel liefen 163 Woerter bis 207,6 s bei 199 s Audio).
    Interpolierte Eintraege tragen Score 0,0 — ein anderes Signal als
    "phonetisch unsicher gemessen".

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    n = len(woerter)
    zeiten: list[WortZeit | None] = [None] * n
    for i in range(n):
        a = anker[i]
        if a is not None:
            zeiten[i] = WortZeit(woerter[i], a.start, a.ende, a.score, a.quelle)

    i = 0
    while i < n:
        if zeiten[i] is not None:
            i += 1
            continue
        lauf_start = i
        while i < n and zeiten[i] is None:
            i += 1
        lauf = list(range(lauf_start, i))
        gewichte = [silbengewicht(woerter[k], sprache) for k in lauf]
        davor = anker[lauf_start - 1] if lauf_start > 0 else None
        danach = anker[i] if i < n else None

        if davor is not None and danach is not None:
            spanne = max(0.05 * (len(lauf) + 1), danach.start - davor.ende)
            atem = sum(gewichte) / len(gewichte)
            summe = sum(gewichte) + atem
            t = davor.ende
            for k, g in zip(lauf, gewichte):
                dauer = spanne * g / summe
                zeiten[k] = WortZeit(woerter[k], t, t + dauer, 0.0, QUELLE_INTERPOLIERT)
                t += dauer
        elif davor is not None:
            # Songende ohne weitere Messung: nach vorn ketten, ~0,15 s je
            # Silbengruppe, aber nie ueber das Audio hinaus.
            t = davor.ende
            dauern = [min(0.8, max(0.2, 0.15 * g)) for g in gewichte]
            uebrig = audio_ende - t
            noetig = sum(dauern)
            if noetig > uebrig > 0:
                faktor = uebrig / noetig
                dauern = [d * faktor for d in dauern]
            for k, dauer in zip(lauf, dauern):
                zeiten[k] = WortZeit(woerter[k], t, t + dauer, 0.0, QUELLE_INTERPOLIERT)
                t += dauer
        elif danach is not None:
            # Songanfang ohne Messung davor: rueckwaerts ketten, endet an
            # der ersten Messung, beginnt fruehestens bei 0.
            t = danach.start
            for k, g in zip(reversed(lauf), reversed(gewichte)):
                dauer = min(0.8, max(0.2, 0.15 * g))
                start = max(0.0, t - dauer)
                zeiten[k] = WortZeit(woerter[k], start, t, 0.0, QUELLE_INTERPOLIERT)
                t = start
        else:
            # Kein einziger Anker im Song: ab 0 ketten, im Audio bleiben.
            # Pass 3 macht daraus anschliessend ein Fenster ueber die
            # volle Spur.
            t = 0.0
            dauern = [min(0.8, max(0.2, 0.15 * g)) for g in gewichte]
            if sum(dauern) > audio_ende > 0:
                faktor = audio_ende / sum(dauern)
                dauern = [d * faktor for d in dauern]
            for k, dauer in zip(lauf, dauern):
                zeiten[k] = WortZeit(woerter[k], t, t + dauer, 0.0, QUELLE_INTERPOLIERT)
                t += dauer

    fertig = [z for z in zeiten if z is not None]
    if len(fertig) != n:
        # Kann nur ein Programmierfehler sein — laut scheitern statt still
        # Woerter verlieren.
        raise AlignmentFailed("Interpolation hat Woerter verloren")
    return fertig


def stille_grenzen(
    audio,
    von_sample: int,
    bis_sample: int,
    abtastrate: int = 16000,
    energie_schwelle: float = 0.01,
    rahmen_ms: float = 20.0,
) -> tuple[int, int]:
    """Trimmt ein Fenster auf den Bereich mit echter Gesangsenergie (RMS je
    Rahmen). Ein Fenster voller Randstille gibt dem CTC keinen Hinweis, wo
    darin das Singen beginnt — er schmiert Woerter in die Stille. Ein
    Rahmen Vorlauf bleibt stehen (Konsonantenansatz). Ohne einen einzigen
    Rahmen ueber der Schwelle bleiben die Grenzen unveraendert.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    import numpy as np

    rahmen_laenge = max(1, int(abtastrate * rahmen_ms / 1000))
    ausschnitt = audio[von_sample:bis_sample]
    if ausschnitt.size < rahmen_laenge:
        return von_sample, bis_sample

    anzahl = ausschnitt.size // rahmen_laenge
    rahmen = ausschnitt[: anzahl * rahmen_laenge].reshape(anzahl, rahmen_laenge)
    rms = np.sqrt(np.mean(rahmen.astype(np.float64) ** 2, axis=1))
    stimmhaft = np.where(rms >= energie_schwelle)[0]
    if stimmhaft.size == 0:
        return von_sample, bis_sample

    erster = max(0, int(stimmhaft[0]) - 1)
    letzter = int(stimmhaft[-1]) + 1
    neu_von = von_sample + erster * rahmen_laenge
    neu_bis = min(bis_sample, von_sample + letzter * rahmen_laenge)
    return neu_von, neu_bis


def _ctc_tokens(wort: str, sprache: str) -> list[str]:
    """Tokens, die dieses Wort gegenueber dem CTC vertreten: Zahlen
    ausgeschrieben, alles andere unveraendert (Satzzeichen verwirft
    whisperx selbst)."""
    kern = "".join(z for z in wort.casefold() if z.isalnum())
    teile = erweitere_zahlwort(kern, sprache)
    return teile if teile != [kern] else [wort]


def _fasse_zusammen(
    roh: list[dict], herkunft: list[int], anzahl: int
) -> list[dict] | None:
    """Fuegt expandierte Tokens wieder zu einer Messung je Ursprungswort
    zusammen (Start des ersten, Ende des letzten, schwaechster Score).
    None, sobald ein Token ohne Zeitstempel dabei ist — dann faellt die
    ganze Luecke sicher auf die Interpolation zurueck."""
    gruppen: list[dict | None] = [None] * anzahl
    for w, pos in zip(roh, herkunft):
        ws, we = w.get("start"), w.get("end")
        if ws is None or we is None:
            return None
        aktuell = gruppen[pos]
        if aktuell is None:
            gruppen[pos] = dict(w)
        else:
            aktuell["start"] = min(float(aktuell["start"]), float(ws))
            aktuell["end"] = max(float(aktuell["end"]), float(we))
            aktuell["score"] = min(
                float(aktuell.get("score", 0.0)), float(w.get("score", 0.0))
            )
    if any(g is None for g in gruppen):
        return None
    return [g for g in gruppen if g is not None]


def _pruefe_fenster(
    woerter_roh: list[dict], fenster_start: float, fenster_ende: float
) -> list[tuple[float, float, float]] | None:
    """Validierung eines Fensterergebnisses: Zeiten vorhanden, im Fenster
    (mit 0,5 s Spiel), monoton steigend. None heisst: Ergebnis verwerfen,
    die Luecke behaelt die Interpolation — ein Fensterfehler reisst nie
    die Pipeline."""
    zeiten: list[tuple[float, float, float]] = []
    letzter_start = fenster_start - 0.001
    for w in woerter_roh:
        ws, we = w.get("start"), w.get("end")
        if ws is None or we is None:
            return None
        ws, we = float(ws), float(we)
        if ws < fenster_start - 0.5 or we > fenster_ende + 0.5 or ws < letzter_start:
            return None
        letzter_start = ws
        zeiten.append((ws, max(we, ws + 0.02), float(w.get("score", 0.0))))
    return zeiten
```

`__all__` um nichts erweitern (die Namen sind modulintern bzw. werden in Task 6 verdrahtet).

- [ ] **Step 4: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_align.py -v` — alle PASS.
Run: `.venv312/Scripts/python.exe -m pytest -q` — komplette Suite gruen.
Formpruefung wie in Task 1.

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/align.py python-sidecar/tests/test_align.py
git commit -m "feat(sidecar): pure building blocks for window alignment and interpolation"
```

---

### Task 6: align() auf Pass 3+4 umstellen und die Pipeline verdrahten

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/align.py`
- Modify: `python-sidecar/ultrastar_pipeline/notes.py` (nur `AlignedWord`)
- Modify: `python-sidecar/ultrastar_pipeline/__main__.py`
- Modify: `python-sidecar/tests/test_align.py`
- Modify: `python-sidecar/tests/test_cli.py` (ein Test fuer `_baue_sections`)

**Interfaces:**
- Consumes: `berechne_anker`, `lese_lrc`, `ordne_lrc_zeilen`, `entlarve_mit_lrc`, `saee_lrc_anker`, `GemessenesWort` (Tasks 3/4); `WortZeit`, `interpoliere`, `stille_grenzen`, `_ctc_tokens`, `_fasse_zusammen`, `_pruefe_fenster` (Task 5).
- Produces: neue Signatur `align(vocals, lines, language, work_dir, audio_hash, device, warnungen, anker: list[GemessenesWort | None]) -> list[AlignedWord]`; `richte_fenster_aus(zeiten, modell, metadaten, audio, device, sprache, warnungen) -> int`; `AlignedWord` mit Feld `quelle: str = "anchor"`; CLI-Option `--synced-lyrics <pfad>`; `_baue_sections(woerter, wort_zu_note) -> list[dict]` in `__main__.py`. `align.STAGE_VERSION = "2"`.
- Cache-Format der align-Stufe neu: `{"words": [...], "warnungen": [...]}` — die alte `deviation` entfaellt (eine Abweichung ist konstruktionsbedingt unmoeglich, die Woerter stammen aus dem Text selbst). `_melde_abweichung` wird entfernt, `zeilen_zuordnen` bleibt.

- [ ] **Step 1: Failing Tests schreiben.**

In `tests/test_align.py` (Imports ergaenzen: `richte_fenster_aus`, `WortZeit`, `GemessenesWort`; numpy wird nur in Stubs importiert):

```python
def _vierpass_platzhalter(
    align_aufrufe: list, fenster_woerter: list[dict]
) -> types.ModuleType:
    """whisperx-Stub fuer den Vierpass-Weg: 30 s stilles Audio, ein
    vorgegebenes Fensterergebnis."""
    import numpy as np

    modul = types.ModuleType("whisperx")
    modul.load_align_model = lambda **k: ("modell", {"meta": True})
    modul.load_audio = lambda pfad: np.zeros(16000 * 30, dtype=np.float32)

    def align_fn(segmente, modell, metadaten, audio, device,
                 interpolate_method=None, return_char_alignments=False):
        align_aufrufe.append(segmente)
        return {"segments": [{"words": fenster_woerter}]}

    modul.align = align_fn
    return modul


def _drei_woerter_anker() -> list:
    return [
        GemessenesWort(1.0, 1.4, 0.5, "anchor"),
        None,
        GemessenesWort(9.0, 9.4, 0.5, "anchor"),
    ]


def test_align_misst_luecken_im_fenster_zwischen_den_nachbarn(tmp_path, monkeypatch):
    aufrufe: list = []
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        aufrufe, [{"word": "zwei", "start": 4.0, "end": 4.5, "score": 0.2}]
    ))
    warnungen: list[str] = []
    woerter = align(
        Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashG", "cpu",
        warnungen, _drei_woerter_anker(),
    )
    assert [w.quelle for w in woerter] == ["anchor", "realign", "anchor"]
    assert woerter[1].start == 4.0 and woerter[1].confidence == 0.2
    assert warnungen == []
    # Das Fenster liegt zwischen Ende des Vorgaengers und Start des
    # Nachfolgers — nicht ueber der ganzen Spur.
    assert aufrufe[0][0]["start"] >= 1.4 - 1e-9
    assert aufrufe[0][0]["end"] <= 9.0 + 1e-9


def test_align_faellt_bei_ausbrechern_auf_interpolation_zurueck(tmp_path, monkeypatch):
    aufrufe: list = []
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        aufrufe, [{"word": "zwei", "start": 25.0, "end": 25.5, "score": 0.9}]
    ))
    warnungen: list[str] = []
    woerter = align(
        Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashH", "cpu",
        warnungen, _drei_woerter_anker(),
    )
    assert woerter[1].quelle == "interpolated"
    assert woerter[1].confidence == 0.0
    assert 1.4 <= woerter[1].start <= 9.0
    assert len(warnungen) == 1 and "Wort" in warnungen[0]


def test_align_cache_traegt_quelle_und_warnungen(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        [], [{"word": "zwei", "start": 25.0, "end": 25.5, "score": 0.9}]
    ))
    erste: list[str] = []
    align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashI", "cpu",
          erste, _drei_woerter_anker())

    kaputt = types.ModuleType("whisperx")  # jeder Zugriff waere ein Fehler
    monkeypatch.setitem(sys.modules, "whisperx", kaputt)
    zweite: list[str] = []
    woerter = align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashI",
                    "cpu", zweite, _drei_woerter_anker())
    assert [w.quelle for w in woerter] == ["anchor", "interpolated", "anchor"]
    assert zweite == erste and len(zweite) == 1


def test_geaenderte_anker_invalidieren_den_align_cache(tmp_path, monkeypatch):
    """Die Anker tragen den Einfluss von Transkript und LRC — ein
    geaenderter Anker darf nie eine alte Ausrichtung wiederverwenden."""
    aufrufe: list = []
    stub = _vierpass_platzhalter(aufrufe, [{"word": "zwei", "start": 4.0, "end": 4.5, "score": 0.2}])
    monkeypatch.setitem(sys.modules, "whisperx", stub)
    align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashJ", "cpu",
          [], _drei_woerter_anker())
    andere = _drei_woerter_anker()
    andere[0] = GemessenesWort(2.0, 2.4, 0.5, "anchor")
    align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashJ", "cpu",
          [], andere)
    assert len(aufrufe) == 2


def test_anker_laenge_muss_zur_wortzahl_passen(tmp_path):
    with pytest.raises(AlignmentFailed):
        align(Path("egal.wav"), ["eins zwei"], "de", tmp_path, "hashK", "cpu",
              [], [None])


def test_song_ohne_anker_bekommt_ein_fenster_ueber_die_volle_spur(tmp_path, monkeypatch):
    aufrufe: list = []
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        aufrufe,
        [
            {"word": "eins", "start": 0.5, "end": 1.0, "score": 0.3},
            {"word": "zwei", "start": 1.1, "end": 1.6, "score": 0.3},
        ],
    ))
    woerter = align(Path("egal.wav"), ["eins zwei"], "de", tmp_path, "hashL", "cpu",
                    [], [None, None])
    assert [w.quelle for w in woerter] == ["realign", "realign"]
    assert aufrufe[0][0]["start"] == 0.0
    assert aufrufe[0][0]["end"] == pytest.approx(30.0)
```

Anpassung der bestehenden align()-Tests in `test_align.py` (die `zeilen_zuordnen`-Tests bleiben unveraendert):

- Jeder bestehende Aufruf `align(..., abschnitte=...)` wird zu `anker=...` mit einer Liste aus `GemessenesWort | None`, deren Laenge der flachen Wortzahl der `lines` entspricht.
- Tests, die das alte Segment-Verhalten pruefen (ein Segment je Abschnitt, `AlignmentFailed` bei Abschnitts-/Wortzahl-Diskrepanz, Abweichungswarnungen `deviation`, Monotonie-Warnung der Segmentreihenfolge), entfallen ersatzlos — ihr Gegenstand existiert nicht mehr; die neuen Tests oben decken die Nachfolger-Invarianten (Fenstergrenzen, Rueckfall, Cache).
- Der bestehende Cache-Treffer-Test und der LanguageUnsupported-Test bleiben inhaltlich, nur mit `anker`-Parameter und neuem Cache-Format `{"words": [...], "warnungen": []}`.

In `tests/test_cli.py` ergaenzen:

```python
def test_sections_beschreiben_laeufe_gleicher_messbarkeit():
    """Zusammenhaengend gemessene Strecken bilden Abschnitte mit mittlerem
    Score, interpolierte Laeufe bekommen confidence 0 — so sieht der
    Nutzer, welchen Teilen des Songs zu trauen ist."""
    import pytest
    import ultrastar_pipeline.__main__ as haupt
    from ultrastar_pipeline.notes import AlignedWord

    woerter = [
        AlignedWord("a", 0.0, 0.5, 0.4, 0, quelle="anchor"),
        AlignedWord("b", 0.5, 1.0, 0.2, 0, quelle="realign"),
        AlignedWord("c", 1.0, 1.5, 0.0, 0, quelle="interpolated"),
        AlignedWord("d", 1.5, 2.0, 0.6, 0, quelle="fuzzy"),
        AlignedWord("e", 2.0, 2.5, 0.0, 0, quelle="interpolated"),
    ]
    wort_zu_note = [0, 1, 2, 3, 4, 5]
    sections = haupt._baue_sections(woerter, wort_zu_note)
    assert sections == [
        {"fromNoteIndex": 0, "toNoteIndex": 2, "confidence": pytest.approx(0.3), "anchoredBothSides": True},
        {"fromNoteIndex": 2, "toNoteIndex": 3, "confidence": 0.0, "anchoredBothSides": True},
        {"fromNoteIndex": 3, "toNoteIndex": 4, "confidence": pytest.approx(0.6), "anchoredBothSides": True},
        # Interpolierter Lauf am Songende: nur einseitig begrenzt.
        {"fromNoteIndex": 4, "toNoteIndex": 5, "confidence": 0.0, "anchoredBothSides": False},
    ]
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_align.py tests/test_cli.py -v`
Expected: neue Tests FAILED (align kennt kein `anker`; `AlignedWord` kein `quelle`; `_baue_sections` fehlt).

- [ ] **Step 3: notes.py** — `AlignedWord` erweitern:

```python
@dataclass(frozen=True)
class AlignedWord:
    text: str
    start: float  # Sekunden
    end: float
    confidence: float
    line_index: int
    # Herkunft des Zeitstempels (anchor/fuzzy/realign/lrc/interpolated).
    # Der Standardwert haelt bestehende Fixtures und Aufrufer gueltig.
    quelle: str = "anchor"
```

- [ ] **Step 4: align.py umbauen.**

1. `STAGE_VERSION = "2"`.
2. `from .anchors import Abschnitt` entfernen; stattdessen sind `GemessenesWort`, `QUELLE_INTERPOLIERT`, `QUELLE_REALIGN` bereits seit Task 5 importiert.
3. `_melde_abweichung` ersatzlos streichen.
4. `richte_fenster_aus` ergaenzen (Pass 3; Portierung von `realign_gap_windows` aus dem Vorbild):

```python
def richte_fenster_aus(
    zeiten: list[WortZeit],
    modell,
    metadaten,
    audio,
    device: str,
    sprache: str,
    warnungen: list[str],
) -> int:
    """Pass 3: je zusammenhaengendem interpoliertem Lauf genau ein
    whisperx.align im Fenster zwischen den gemessenen Nachbarn (bzw.
    Audio-Anfang/-Ende). Vorher wird Randstille getrimmt und Zahlen fuer
    den CTC ausgeschrieben; das Ergebnis wird validiert und bei Verstoss
    verworfen — ein Fensterfehler reisst nie die Pipeline, die Luecke
    behaelt dann sichtbar die Interpolation. Mutiert `zeiten` in place,
    liefert die Zahl befoerderter Woerter.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    import whisperx

    abtastrate = 16000  # whisperx.audio.SAMPLE_RATE
    audio_dauer = float(len(audio)) / abtastrate
    n = len(zeiten)
    befoerdert = 0
    i = 0
    while i < n:
        if zeiten[i].quelle != QUELLE_INTERPOLIERT:
            i += 1
            continue
        lauf_start = i
        while i < n and zeiten[i].quelle == QUELLE_INTERPOLIERT:
            i += 1
        lauf = list(range(lauf_start, i))

        fenster_start = zeiten[lauf_start - 1].ende if lauf_start > 0 else 0.0
        fenster_ende = zeiten[i].start if i < n else audio_dauer
        fenster_start = max(0.0, min(fenster_start, audio_dauer))
        fenster_ende = max(0.0, min(fenster_ende, audio_dauer))

        von_sample, bis_sample = stille_grenzen(
            audio,
            int(fenster_start * abtastrate),
            int(fenster_ende * abtastrate),
            abtastrate,
        )
        fenster_start = von_sample / abtastrate
        fenster_ende = bis_sample / abtastrate

        tokens: list[str] = []
        herkunft: list[int] = []
        for pos, k in enumerate(lauf):
            for teil in _ctc_tokens(zeiten[k].text, sprache):
                tokens.append(teil)
                herkunft.append(pos)

        # Zu knappes Fenster: bewusst stiller Verzicht — zwischen zwei
        # nahen Messungen ist die Interpolation ohnehin eng begrenzt, und
        # die Quelle bleibt ueber sections sichtbar.
        if fenster_ende - fenster_start < 0.10 + 0.08 * len(tokens):
            continue

        segment = {"start": fenster_start, "end": fenster_ende, "text": " ".join(tokens)}
        try:
            ergebnis = whisperx.align(
                [segment], modell, metadaten, audio, device,
                interpolate_method="nearest", return_char_alignments=False,
            )
        except Exception:
            warnungen.append(
                f"Fenster-Alignment fehlgeschlagen fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue

        roh = [w for seg in ergebnis.get("segments", []) for w in seg.get("words", [])]
        if len(roh) != len(tokens):
            warnungen.append(
                f"Fenster-Alignment lieferte {len(roh)} statt {len(tokens)} Tokens "
                f"fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue
        woerter_roh = _fasse_zusammen(roh, herkunft, len(lauf))
        if woerter_roh is None:
            warnungen.append(
                f"Fenster-Alignment ohne Zeitstempel fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue
        neu = _pruefe_fenster(woerter_roh, fenster_start, fenster_ende)
        if neu is None:
            warnungen.append(
                f"Fenster-Alignment unplausibel (Fenstergrenzen/Monotonie) "
                f"fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue

        for k, (ws, we, score) in zip(lauf, neu):
            zeiten[k].start = ws
            zeiten[k].ende = we
            zeiten[k].score = score
            zeiten[k].quelle = QUELLE_REALIGN
            befoerdert += 1
    return befoerdert
```

5. `align()` ersetzen:

```python
def align(
    vocals: Path,
    lines: list[str],
    language: str,
    work_dir: Path,
    audio_hash: str,
    device: str,
    warnungen: list[str],
    anker: list[GemessenesWort | None],
) -> list[AlignedWord]:
    """Paesse 3 und 4: Interpolation als Grundierung, Fenster-Alignment
    fuer jede unverankerte Luecke. Jedes Wort traegt seine Quelle."""
    flach = [wort for zeile in lines for wort in zeile.split()]
    if not flach:
        raise AlignmentFailed("keine Woerter im Text")
    # Die Anker wurden gegen eine anderswo gebildete Wortliste berechnet.
    # Passt die Laenge nicht, zeigten alle Indizes auf falsche Woerter —
    # abbrechen statt still falsch ausrichten.
    if len(anker) != len(flach):
        raise AlignmentFailed(
            f"Anker decken {len(anker)} Woerter ab, der Text hat {len(flach)}"
        )

    text_digest = hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]
    # Die Anker gehen in den Schluessel ein: sie tragen den Einfluss von
    # Transkript UND LRC. Ein geaenderter Anker darf nie eine alte
    # Ausrichtung wiederverwenden.
    anker_digest = hashlib.sha256(
        json.dumps(
            [None if a is None else [a.start, a.ende, a.score, a.quelle] for a in anker]
        ).encode("utf8")
    ).hexdigest()[:16]
    ziel = stage_path(
        work_dir,
        audio_hash,
        "align",
        {
            "language": language,
            "lines": len(lines),
            "text": text_digest,
            "anker": anker_digest,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        gespeichert = json.loads(ziel.read_text(encoding="utf8"))
        # Die Warnungen des urspruenglichen Laufs gelten auch beim Treffer:
        # sie beschreiben das Ergebnis, nicht den Weg dorthin.
        warnungen.extend(gespeichert["warnungen"])
        emit_progress("align", 1.0)
        return [AlignedWord(**w) for w in gespeichert["words"]]

    emit_progress("align", 0.0)
    import whisperx

    try:
        modell, metadaten = whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(language) from exc

    audio = whisperx.load_audio(str(vocals))
    audio_dauer = float(len(audio)) / 16000.0

    neue_warnungen: list[str] = []
    zeiten = interpoliere(anker, flach, language, audio_dauer)
    richte_fenster_aus(zeiten, modell, metadaten, audio, device, language, neue_warnungen)

    woerter = [
        AlignedWord(
            text=z.text,
            start=z.start,
            end=z.ende,
            confidence=z.score,
            line_index=0,  # wird durch zeilen_zuordnen ersetzt
            quelle=z.quelle,
        )
        for z in zeiten
    ]
    # Zeilenzuordnung wie bisher ueber die Wortanzahl je Zeile. Eine
    # Abweichung ist konstruktionsbedingt unmoeglich (die Woerter stammen
    # aus dem Text selbst), darum gibt es keine Abweichungswarnung mehr.
    woerter, _ = zeilen_zuordnen(woerter, lines)

    warnungen.extend(neue_warnungen)
    atomic_write_bytes(
        ziel,
        json.dumps(
            {"words": [w.__dict__ for w in woerter], "warnungen": neue_warnungen},
            ensure_ascii=False,
        ).encode("utf8"),
    )
    emit_progress("align", 1.0)
    return woerter
```

6. Modul-Docstring anpassen: nicht mehr "duenner Adapter", sondern Paesse 3+4 des Vierpass-Modells (die reine Entscheidungslogik liegt in den testbaren Bausteinen, nur die Modellaufrufe sind duenn).

- [ ] **Step 5: __main__.py verdrahten.**

1. Argument ergaenzen: `p.add_argument("--synced-lyrics", type=Path, default=None)` (argparse macht daraus `args.synced_lyrics`).
2. Den Block von `anker = anchors.finde_anker(...)` bis einschliesslich der `schwach`-Warnung ersetzen durch:

```python
        anker = anchors.berechne_anker(flach, transkript)
        if args.synced_lyrics is not None:
            if args.synced_lyrics.is_file():
                lrc_zeilen = anchors.lese_lrc(
                    args.synced_lyrics.read_text(encoding="utf8")
                )
                pfosten = anchors.ordne_lrc_zeilen(zeilen, lrc_zeilen)
                # Erst entlarven, dann saeen: entlarvte Luecken sollen neu
                # besaet werden koennen.
                anchors.entlarve_mit_lrc(anker, pfosten, dauer_sekunden(vocals))
                anchors.saee_lrc_anker(anker, pfosten)
            else:
                warnungen.append(
                    "Synchronisierte Lyrics nicht lesbar, weiter ohne LRC-Anker."
                )
```

3. Der `align(...)`-Aufruf bekommt `anker` statt `abschnitte`.
4. Nach dem `len(woerter) != len(flach)`-Wachposten (bleibt bestehen — er sichert die wort_zu_note-Uebersetzung):

```python
        interpoliert = sum(1 for w in woerter if w.quelle == "interpolated")
        if interpoliert:
            warnungen.append(
                f"{interpoliert} von {len(woerter)} Woertern ohne Messung (interpoliert)."
            )
```

5. Den bisherigen `sections = [...]`-Ausdruck ersetzen durch `sections = _baue_sections(woerter, wort_zu_note)` und auf Modulebene ergaenzen:

```python
def _baue_sections(woerter, wort_zu_note: list[int]) -> list[dict]:
    """Sections beschreiben Laeufe gleicher Messbarkeit: zusammenhaengend
    gemessene Strecken (anchor/fuzzy/realign/lrc) mit mittlerem
    phonetischem Score, interpolierte Laeufe mit confidence 0.
    anchoredBothSides heisst: beidseitig von gemessenen Woertern begrenzt
    — fuer gemessene Laeufe trivial wahr, fuer interpolierte genau dann,
    wenn sie nicht am Songanfang oder -ende liegen."""
    sections: list[dict] = []
    i = 0
    n = len(woerter)
    while i < n:
        gemessen = woerter[i].quelle != "interpolated"
        j = i
        while j < n and (woerter[j].quelle != "interpolated") == gemessen:
            j += 1
        sections.append(
            {
                "fromNoteIndex": wort_zu_note[i],
                "toNoteIndex": wort_zu_note[j],
                "confidence": (
                    sum(w.confidence for w in woerter[i:j]) / (j - i) if gemessen else 0.0
                ),
                "anchoredBothSides": True if gemessen else (i > 0 and j < n),
            }
        )
        i = j
    return sections
```

6. Der Kommentar ueber der alten `sections`-Liste (Wortindizes -> Notenindizes) wandert sinngemaess in `_baue_sections`; der Aufruf von `anchors.baue_abschnitte` und der `dauer_sekunden`-Kommentar dazu entfallen (die Funktionen selbst raeumt Task 7 ab). Modul-Docstring: Reihenfolge um `anchors` ergaenzen.

- [ ] **Step 6: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest -q` — komplette Suite gruen (inkl. angepasster test_align.py).
Formpruefung wie in Task 1 ueber alle vier geaenderten .py-Dateien.

- [ ] **Step 7: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/align.py python-sidecar/ultrastar_pipeline/notes.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/tests/test_align.py python-sidecar/tests/test_cli.py
git commit -m "feat(sidecar): four-pass alignment wired end to end"
```

---

### Task 7: Altlast Abschnitte entfernen

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/anchors.py`
- Modify: `python-sidecar/tests/test_anchors.py`
- Modify: `docs/superpowers/specs/2026-07-28-alignment-anker-design.md` (2-3 Zeilen Nachtrag)

**Interfaces:**
- Entfernt werden: `Anchor`, `finde_anker`, `Abschnitt`, `baue_abschnitte`, `MAX_WOERTER_PRO_SEKUNDE`, `RAND_SEKUNDEN_JE_WORT` — samt aller zugehoerigen Tests. Nach Task 6 referenziert kein Produktivcode sie mehr; ihre Aufgabe (Fenstergrenzen aus Ankern) lebt praeziser in Pass 3.

- [ ] **Step 1: Verwaiste Nutzung ausschliessen**

Run: `git grep -n "finde_anker\|baue_abschnitte\|Abschnitt\b\|MAX_WOERTER_PRO_SEKUNDE\|RAND_SEKUNDEN_JE_WORT" -- "*.py"`
Expected: Treffer nur noch in `anchors.py` selbst und `tests/test_anchors.py`. Gibt es weitere Treffer, STOPP und als Konflikt melden statt blind loeschen.

- [ ] **Step 2: Entfernen**

In `anchors.py`: die Dataclasses `Anchor` und `Abschnitt`, die Funktionen `finde_anker` und `baue_abschnitte` sowie die Konstanten `MAX_WOERTER_PRO_SEKUNDE` und `RAND_SEKUNDEN_JE_WORT` loeschen. `_lcs_paare`, `normalisiere`, `berechne_anker`, die Fuzzy-/Misstrauens-/LRC-Funktionen bleiben. Der Modul-Docstring verliert jeden Bezug auf Abschnitte.

In `tests/test_anchors.py`: alle Tests loeschen, die `finde_anker`, `Anchor` oder `baue_abschnitte` verwenden (darunter die Zeitfenster-, Ratenwaechter- und Rand-Klemm-Tests). Der LCS-Kern bleibt getestet: falls kein bestehender `berechne_anker`-Test den wiederholten Refrain abdeckt, diesen Test von `finde_anker` auf `berechne_anker` portieren statt loeschen:

```python
def test_wiederholter_refrain_bindet_an_die_richtige_stelle():
    """Der greedy difflib-Ansatz band einen wortgleich wiederholten
    Refrain an die falsche Stelle und liess 80 Woerter ohne Anker (Pilot);
    die echte LCS kann das nicht."""
    gehoerte = _gehoert(
        [("ref", 10.0, 10.3, 0.5), ("mitte", 20.0, 20.3, 0.5), ("ref", 30.0, 30.3, 0.5)]
    )
    anker = berechne_anker(["ref", "mitte", "ref"], gehoerte)
    assert anker[0].start == 10.0
    assert anker[1].start == 20.0
    assert anker[2].start == 30.0
```

- [ ] **Step 3: Spec-Nachtrag**

Ans Ende von `docs/superpowers/specs/2026-07-28-alignment-anker-design.md` (bestehender Nachtrag vom 2026-07-29) zwei, drei Zeilen: Abschnitte, Ratenwaechter und Rand-Klemmung sind durch das Vierpass-Modell ersetzt (siehe `2026-07-29-alignment-vierpass-design.md`); die echte LCS und die Messharness leben dort weiter.

- [ ] **Step 4: Gruen belegen**

Run: `.venv312/Scripts/python.exe -m pytest -q` — komplette Suite gruen.
Formpruefung wie in Task 1.

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/anchors.py python-sidecar/tests/test_anchors.py docs/superpowers/specs/2026-07-28-alignment-anker-design.md
git commit -m "refactor(sidecar): drop section machinery superseded by four-pass model"
```

---

### Task 8: lrclib.ts — synchronisierte Lyrics holen und cachen

**Files:**
- Create: `src/core/create/lrclib.ts`
- Create: `src/core/create/lrclib.test.ts`

**Interfaces:**
- Produces: `holeSyncedLyrics(anfrage: LrclibAnfrage): Promise<string | null>` (liefert den Pfad zur gecachten .lrc-Datei oder null) und `cachedLyricsPfad(songDir: string): Promise<string | null>` (nur Cache-Blick, kein Netz). `LrclibAnfrage = { artist: string; title: string; durationSec: number; songDir: string; fetchFn?: typeof fetch }`. Konsumiert von `scripts/evaluate-pipeline.ts` (Task 9).

- [ ] **Step 1: Failing Tests schreiben** — `src/core/create/lrclib.test.ts`:

```typescript
// src/core/create/lrclib.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { cachedLyricsPfad, holeSyncedLyrics } from "./lrclib.ts";

const tempDir = () => mkdtemp(join(tmpdir(), "lrclib-test-"));

const fakeFetch = (
  aufrufe: string[],
  antwort: () => Response,
): typeof fetch =>
  (async (eingabe: RequestInfo | URL) => {
    aufrufe.push(String(eingabe));
    return antwort();
  }) as typeof fetch;

describe("holeSyncedLyrics", () => {
  it("cached einen Treffer im Songverzeichnis und liefert den Pfad", async () => {
    const dir = await tempDir();
    const aufrufe: string[] = [];
    const pfad = await holeSyncedLyrics({
      artist: "Kuenstler",
      title: "Titel",
      durationSec: 180.4,
      songDir: dir,
      fetchFn: fakeFetch(aufrufe, () =>
        Response.json({ syncedLyrics: "[00:12.00]erste zeile" }),
      ),
    });
    expect(pfad).toBe(join(dir, "synced-lyrics.lrc"));
    expect(await readFile(pfad as string, "utf8")).toBe("[00:12.00]erste zeile");
    // Der Get-Endpunkt bekommt die exakte Signatur, Dauer gerundet.
    expect(aufrufe[0]).toContain("artist_name=K");
    expect(aufrufe[0]).toContain("duration=180");
  });

  it("liefert null bei 404 und cached nichts", async () => {
    const dir = await tempDir();
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: fakeFetch([], () => new Response("not found", { status: 404 })),
    });
    expect(pfad).toBeNull();
    expect(await cachedLyricsPfad(dir)).toBeNull();
  });

  it("liefert null, wenn nur unsynchronisierte Lyrics existieren", async () => {
    const dir = await tempDir();
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: fakeFetch([], () => Response.json({ syncedLyrics: null, plainLyrics: "text" })),
    });
    expect(pfad).toBeNull();
  });

  it("liefert null bei Netzfehler statt zu werfen", async () => {
    const dir = await tempDir();
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(pfad).toBeNull();
  });

  it("nutzt den Cache ohne weiteren Netzzugriff", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "synced-lyrics.lrc"), "[00:01.00]zeile", "utf8");
    const aufrufe: string[] = [];
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: fakeFetch(aufrufe, () => Response.json({})),
    });
    expect(pfad).toBe(join(dir, "synced-lyrics.lrc"));
    expect(aufrufe).toEqual([]);
    expect(await cachedLyricsPfad(dir)).toBe(pfad);
  });
});
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `bun test src/core/create/lrclib.test.ts`
Expected: FAIL (Modul existiert nicht).

- [ ] **Step 3: Implementierung** — `src/core/create/lrclib.ts`:

```typescript
// src/core/create/lrclib.ts
// Zweite Evidenzquelle fuer das Alignment: synchronisierte Lyrics (.lrc)
// von lrclib.net. Bewusst nur der exakte Get-Endpunkt (Artist, Titel,
// Dauer; der Server toleriert +-2 s) — eine Fuzzy-Suche koennte die
// falsche Edition liefern, und ein falsches .lrc setzt falsche Pfosten.
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LrclibAnfrage = {
  artist: string;
  title: string;
  durationSec: number;
  songDir: string;
  /** Tests injizieren hier einen Ersatz — nie gegen das echte Netz testen. */
  fetchFn?: typeof fetch;
};

const CACHE_DATEI = "synced-lyrics.lrc";

/** Pfad zur gecachten .lrc im Songverzeichnis, ohne Netzzugriff. */
export const cachedLyricsPfad = async (songDir: string): Promise<string | null> => {
  const pfad = join(songDir, CACHE_DATEI);
  try {
    await access(pfad);
    return pfad;
  } catch {
    return null;
  }
};

/**
 * Holt synchronisierte Lyrics und cached Treffer im Songverzeichnis.
 * Jeder Fehlschlag (kein Treffer, nur unsynchronisierter Text, Netz weg)
 * liefert null — eine fehlende .lrc ist nie ein Abbruchgrund, nur eine
 * fehlende zweite Evidenzquelle.
 */
export const holeSyncedLyrics = async (a: LrclibAnfrage): Promise<string | null> => {
  const imCache = await cachedLyricsPfad(a.songDir);
  if (imCache) return imCache;

  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  url.searchParams.set("duration", String(Math.round(a.durationSec)));

  const f = a.fetchFn ?? fetch;
  try {
    const antwort = await f(url.toString(), {
      // lrclib.net bittet Clients, sich zu identifizieren.
      headers: { "User-Agent": "UltraStar-CLI (https://github.com/normannormalmann/UltraStar-CLI)" },
    });
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { syncedLyrics?: string | null };
    if (!daten.syncedLyrics) return null;
    const pfad = join(a.songDir, CACHE_DATEI);
    await writeFile(pfad, daten.syncedLyrics, "utf8");
    return pfad;
  } catch {
    return null;
  }
};
```

- [ ] **Step 4: Gruen belegen**

Run: `bun test src/core/create/lrclib.test.ts` — alle PASS.
Run: `bun test src` und `bunx tsc --noEmit` — sauber.

- [ ] **Step 5: Commit**

```bash
git add src/core/create/lrclib.ts src/core/create/lrclib.test.ts
git commit -m "feat(create): fetch and cache synced lyrics from lrclib"
```

---

### Task 9: Pipeline-Plumbing und Bewertungslauf mit LRC

**Files:**
- Modify: `src/core/create/pipeline.ts`
- Modify: `src/core/create/pipeline.test.ts`
- Modify: `scripts/evaluate-pipeline.ts`

**Interfaces:**
- Consumes: `holeSyncedLyrics`, `cachedLyricsPfad` (Task 8); Sidecar-Option `--synced-lyrics` (Task 6).
- Produces: `PipelineInput.syncedLyricsPath?: string`; der Bewertungslauf nutzt LRCLIB je Song und weist im Bericht aus, ob ein .lrc vorlag.

- [ ] **Step 1: Failing Test schreiben** — in `src/core/create/pipeline.test.ts` (nutzt die bestehenden Helfer `fakeSidecar`, `basis`, `gueltigesJson`):

```typescript
  it("reicht syncedLyricsPath als --synced-lyrics durch", async () => {
    const { bin, dir } = await fakeSidecar(`
      const i = process.argv.indexOf("--synced-lyrics");
      if (i === -1 || !process.argv[i + 1].endsWith("songtext.lrc")) process.exit(1);
      const out = process.argv[process.argv.indexOf("--out") + 1];
      await Bun.write(out, ${JSON.stringify(gueltigesJson)});
    `);
    const daten = await Effect.runPromise(
      runPipeline({
        ...basis(dir),
        pythonBin: bin,
        syncedLyricsPath: join(dir, "songtext.lrc"),
      }),
    );
    expect(daten.bpm).toBe(120);
  });
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `bun test src/core/create/pipeline.test.ts`
Expected: der neue Test FAILED (Typfehler/Exit 1), Bestand PASS.

- [ ] **Step 3: pipeline.ts** — `PipelineInput` ergaenzen:

```typescript
  /** Pfad zu einer synchronisierten .lrc (LRCLIB) als zweite Evidenzquelle. */
  syncedLyricsPath?: string;
```

und in `baueArgumente`:

```typescript
  if (input.syncedLyricsPath) args.push("--synced-lyrics", input.syncedLyricsPath);
```

- [ ] **Step 4: evaluate-pipeline.ts umbauen.**

Die Dauer fuer den LRCLIB-Get-Endpunkt ist erst nach einem Pipeline-Lauf bekannt (`meta.durationSec`). Deshalb je Song: erst mit dem Cache-Blick starten; liegt keine .lrc vor, einmal ohne LRC laufen, dann holen und bei Treffer erneut laufen — die teuren Stufen sind gecacht, nur align rechnet neu (der Anker-Digest im Cache-Schluessel sorgt genau dafuer).

Import ergaenzen: `import { cachedLyricsPfad, holeSyncedLyrics } from "../src/core/create/lrclib.ts";`
Ergebnistyp erweitern: `const ergebnisse: { name: string; m: Metrics; lrc: boolean }[] = [];`

Die Schleifenmitte (ab `const ergebnis = await Effect.runPromise(...)` bis zum `ergebnisse.push(...)`) wird zu:

```typescript
    const lauf = (syncedLyricsPath?: string) =>
      Effect.runPromise(
        Effect.either(
          runPipeline({
            audioPath: audio,
            lyricsPath: lyricsPfad,
            language: sprache,
            outPath: join(song.songDir, ".eval-song-data.json"),
            device: "auto",
            pythonBin,
            ...(syncedLyricsPath ? { syncedLyricsPath } : {}),
            onProgress: (stage, p) =>
              process.stderr.write(`\r${song.title}: ${stage} ${Math.round(p * 100)}%    `),
          }),
        ),
      );

    // Cache zuerst: bei wiederholten Bewertungslaeufen liegt die .lrc
    // schon im Songverzeichnis und es braucht nur einen Pipeline-Lauf.
    let lrcPfad = await cachedLyricsPfad(song.songDir);
    let ergebnis = await lauf(lrcPfad ?? undefined);
    process.stderr.write("\n");

    if (ergebnis._tag === "Right" && !lrcPfad) {
      // Die Dauer ist erst jetzt bekannt — holen und bei Treffer neu
      // ausrichten (nur align rechnet neu, der Rest kommt aus dem Cache).
      lrcPfad = await holeSyncedLyrics({
        artist: song.artist,
        title: song.title,
        durationSec: ergebnis.right.meta.durationSec,
        songDir: song.songDir,
      });
      if (lrcPfad) {
        ergebnis = await lauf(lrcPfad);
        process.stderr.write("\n");
      }
    }

    if (ergebnis._tag === "Left") {
      console.error(`${song.title}: FEHLER ${ergebnis.left.kind} ${ergebnis.left.detail ?? ""}`);
      continue;
    }

    const unser = parseReferenceTxt(
      renderSongTxt(ergebnis.right, {
        artist: song.artist,
        title: song.title,
        mp3: "x.ogg",
      }),
    );
    ergebnisse.push({
      name: `${song.artist} - ${song.title}`,
      m: compareToReference(unser, referenz),
      lrc: lrcPfad !== null,
    });
```

Bericht: Tabellenkopf um eine Spalte `LRC` ergaenzen (nach `Song`), Datenzeile mit `${lrc ? "ja" : "nein"}`, Trennerzeile anpassen. Aggregat ergaenzen:

```typescript
  const mitLrc = ergebnisse.filter((z) => z.lrc).length;
  console.log(`Songs mit LRC:       ${mitLrc}/${ergebnisse.length}`);
```

(Beim Destrukturieren der Berichtsschleife `const { name, m, lrc } of ergebnisse` verwenden.)

- [ ] **Step 5: Gruen belegen**

Run: `bun test src` — alle PASS.
Run: `bunx tsc --noEmit` — sauber. (`scripts/` wird von tsc miterfasst, der Umbau muss typsauber sein.)

- [ ] **Step 6: Commit**

```bash
git add src/core/create/pipeline.ts src/core/create/pipeline.test.ts scripts/evaluate-pipeline.ts
git commit -m "feat(create): synced lyrics plumbing for pipeline and evaluation"
```

---

### Task 10: Pilot-Rerun (5 Songs) und Messbericht

Kein Subagent-Task im engen Sinn — der Controller fuehrt den Lauf aus und bewertet. GPU noetig.

**Files:**
- Read: `scripts/reference-corpus.json` (git-ignoriert, 5 Songs)

- [ ] **Step 1: Lauf**

```bash
PIPELINE_PYTHON="python-sidecar/.venv312/Scripts/python.exe" bun run scripts/evaluate-pipeline.ts scripts/reference-corpus.json > pilot-vierpass.txt 2> pilot-vierpass-log.txt
```

(Ausgabe in eine Datei im Scratchpad umleiten, nicht durch `tail` pipen — gepufferte Pipes haben schon einmal eine leere Ausgabedatei erzeugt.)

Hinweis: `transcribe.STAGE_VERSION = "2"` invalidiert den Transkript-Cache absichtlich — der Lauf rechnet Transkription und Alignment fuer alle 5 Songs neu (GPU, mehrere Minuten je Song).

- [ ] **Step 2: Bewertung gegen die Basislinie**

Basislinie (Pilot nach LCS-Fix, 2026-07-29): Aggregat 84 % gepaart, Median 191/85/172/595/12513 ms je Song, 13 % < 50 ms. Zu beantworten:

1. Verbessert das Vierpass-Modell jeden Song oder gibt es Regressionen?
2. Wie viele Songs bekamen ein .lrc, und hilft es messbar (insbesondere beim Chor-Song mit konstantem 12,5-s-Versatz)?
3. Wie hoch ist der interpolierte Anteil je Song (Warnung im Bericht bzw. sections)?
4. Reicht die Kurve Richtung 80 % < 50 ms, um den 30+-Korpus (urspruenglicher Task 8 des 1b-Plans) anzugehen, oder braucht es erst weitere Justierung?

Ergebnis als Bericht an den Nutzer, nur Zahlen, keine Songtexte. Danach Entscheidung des Nutzers einholen: weiter zum 30+-Korpus oder justieren.

---

## Ausfuehrungshinweise

- Reihenfolge strikt 1 -> 10; jede Task laesst die komplette Suite gruen zurueck.
- Task 6 ist die einzige Task mit Integrations-Charakter (vier Dateien, Signaturwechsel) — Implementer auf einem Standard-Modell, nicht dem billigsten.
- Task 10 erst nach Review-Abschluss von 1-9.






