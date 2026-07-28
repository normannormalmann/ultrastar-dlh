# Alignment mit Ankern — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Forced Alignment bekommt Anker aus einer freien Transkription, damit es in instrumentalen und wiederholten Passagen nicht mehr lokal verrutscht.

**Architecture:** Eine neue Modellstufe (`transcribe.py`) liefert gehörte Wörter mit Zeiten. Eine neue reine Einheit (`anchors.py`) matcht den bekannten Liedtext monoton dagegen und schneidet ihn in Abschnitte mit eigenem Zeitfenster. `align.py` übergibt WhisperX künftig ein Segment je Abschnitt statt eines über die ganze Aufnahme. Die entscheidende Logik ist rein und ohne GPU testbar; die Modellstufen bleiben dünne Adapter.

**Tech Stack:** Python 3.12 im Sidecar (WhisperX, Demucs, SwiftF0, librosa), TypeScript/Bun mit Effect auf der Orchestrierungsseite, pytest und `bun test`.

**Spec:** [2026-07-28-alignment-anker-design.md](../specs/2026-07-28-alignment-anker-design.md)

## Global Constraints

- **Zielmarke der Abnahme:** 80 % der Silben unter 50 ms, über 30+ gemischte Referenzsongs, je Song einzeln ausgewiesen.
- **Interpreter:** immer `python-sidecar/.venv312/Scripts/python.exe`. Nie das globale Python — die Modellpakete liegen ausschließlich in dieser venv.
- **Sprache im Code:** Bezeichner und Kommentare auf Deutsch, ohne Umlaute im Python-Quelltext (bestehende Konvention: `Woerter`, `naechste`). Docstrings erklären das *Warum*, nicht das *Was*.
- **Fail loudly:** Abweichungen werden als Warnung gemeldet oder als strukturierter Fehler geworfen, nie still verschluckt.
- **Cache-Schlüsselung:** Jede Stufe nimmt die Identität *aller* Vorstufen in ihren Schlüssel auf. Eine Änderung an `separate` muss `transcribe`, `align` und `pitch` invalidieren.
- **Keine Umgebungs-Tests:** Ein Test darf nie „Paket ist nicht installiert" als Beweismittel benutzen. Zustände werden über vorgeschaltete Platzhaltermodule erzwungen.
- **Ausgabetext bleibt Quelltext:** Normalisierung dient ausschließlich dem Vergleich, nie der Ausgabe.

## Vorbereitung

Isolierten Arbeitsbereich anlegen (Skill `superpowers:using-git-worktrees`). Der bestehende Worktree `UltraStar-CLI-pipeline-core` gehört zum abgeschlossenen Teilprojekt 1 — **nicht wiederverwenden**, sondern einen neuen Branch von `main` abzweigen, etwa `feat/alignment-anker`.

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `python-sidecar/ultrastar_pipeline/transcribe.py` | *neu* — dünner ASR-Adapter, Cache, sonst nichts |
| `python-sidecar/ultrastar_pipeline/anchors.py` | *neu* — rein: Normalisierung, monotones Matching, Abschnittsbildung |
| `python-sidecar/ultrastar_pipeline/align.py` | *geändert* — ein Segment je Abschnitt statt eines global |
| `python-sidecar/ultrastar_pipeline/__main__.py` | *geändert* — Transkriptionsstufe einhängen, Abschnitte durchreichen |
| `python-sidecar/tests/test_anchors.py` | *neu* — trägt die Beweislast, ohne Modell |
| `python-sidecar/tests/test_transcribe.py` | *neu* — Cache und stufenübergreifende Invalidierung |
| `src/core/create/songData.ts` | *geändert* — Vertrag um `sections` erweitert, Version angehoben |
| `src/core/create/evaluate.ts` | *geändert* — signierter Versatz und Driftprofil |
| `scripts/evaluate-pipeline.ts` | *geändert* — neue Kennzahlen im Bericht |
| `scripts/probe-ankerausbeute.py` | *neu, Task 1* — einmalige Probe, bleibt als Diagnosewerkzeug |

---

### Task 1: Ankerausbeute-Probe — das Abbruchkriterium

**Zweck:** Der gesamte Entwurf hängt an einer unbewiesenen Annahme: dass ASR auf einer Gesangsspur genug wiedererkennt, um Anker zu liefern. Diese Aufgabe prüft das, **bevor** Produktionscode entsteht.

**Files:**
- Create: `scripts/probe-ankerausbeute.py`

**Interfaces:**
- Consumes: nichts aus späteren Tasks. Nutzt den bestehenden Cache aus Teilprojekt 1.
- Produces: eine Entscheidung, keinen Code. Die hier von Hand geschriebene Matching-Logik wird in Task 3 durch `anchors.py` ersetzt.

- [ ] **Step 1: Probe schreiben**

```python
"""Einmalige Probe: liefert ASR auf einer Gesangsspur genug Anker?

Kein Produktionscode. Die Matching-Logik hier ist absichtlich naiv — sie
beantwortet nur die Frage, ob der Entwurf tragfaehig ist.
"""

import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path


def normalisiere(wort: str) -> str:
    """Kleinschreibung, Diakritika und Satzzeichen weg — nur fuer Vergleiche."""
    zerlegt = unicodedata.normalize("NFKD", wort.casefold())
    ohne_marken = "".join(z for z in zerlegt if not unicodedata.combining(z))
    return "".join(z for z in ohne_marken if z.isalnum())


def main() -> int:
    if len(sys.argv) != 4:
        print("Aufruf: probe-ankerausbeute.py <vocals.wav> <lyrics.txt> <sprache>")
        return 2
    vocals, lyrics_pfad, sprache = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

    bekannte = [
        w
        for zeile in lyrics_pfad.read_text(encoding="utf8").splitlines()
        if zeile.strip()
        for w in zeile.split()
    ]

    import whisperx

    modell = whisperx.load_model("large-v2", "cuda", compute_type="float16")
    ergebnis = modell.transcribe(str(vocals), language=sprache)
    gehoerte = [
        w
        for segment in ergebnis.get("segments", [])
        for w in str(segment.get("text", "")).split()
    ]

    a = [normalisiere(w) for w in bekannte]
    b = [normalisiere(w) for w in gehoerte]
    treffer = sum(
        block.size
        for block in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks()
    )

    print(f"bekannte Woerter:   {len(bekannte)}")
    print(f"gehoerte Woerter:   {len(gehoerte)}")
    print(f"Anker (Teilfolge):  {treffer}")
    print(f"Ausbeute:           {treffer / max(1, len(bekannte)) * 100:.0f}%")
    print(f"Segmente:           {len(ergebnis.get('segments', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Probe ausführen**

Die getrennte Gesangsspur liegt bereits im Cache des Teilprojekt-1-Laufs (`.pipeline-cache/<hash>/separate-*.wav`), ebenso der Liedtext (`.eval-lyrics.txt` im Songverzeichnis). Beides direkt verwenden — kein neuer Demucs-Lauf nötig.

Run:
```bash
python-sidecar/.venv312/Scripts/python.exe scripts/probe-ankerausbeute.py \
  <pfad/zur/separate-*.wav> <pfad/zur/.eval-lyrics.txt> de
```

- [ ] **Step 3: Entscheiden**

Bewertung, gemessen an den 156 bekannten Wörtern des Referenzsongs:

| Ausbeute | Bedeutung | Konsequenz |
|---|---|---|
| **> 60 %** | Reichlich Anker, auch bei grober Abschnittsbildung | Plan wie geschrieben fortsetzen |
| **35–60 %** | Tragfähig, aber Abschnitte müssen größer ausfallen | Fortsetzen, `zielgroesse` in Task 4 großzügiger wählen |
| **15–35 %** | Dünn. Anker nur als grobe Leitplanken brauchbar | Fortsetzen, aber Erwartung an die 80-%-Marke mit dem Nutzer neu verhandeln |
| **< 15 %** | **Abbruch.** Der Entwurf trägt nicht | Stoppen, Ergebnis dem Nutzer vorlegen, Spec überdenken |

**Bei Abbruch:** nicht weiterarbeiten. Das Ergebnis mit den Zahlen dem Nutzer melden und auf eine Entscheidung warten.

- [ ] **Step 4: Befund festhalten und committen**

Ergebnis als Nachtrag in den Abschnitt „Risiken" der Spec schreiben, mit den gemessenen Zahlen.

```bash
git add scripts/probe-ankerausbeute.py docs/superpowers/specs/2026-07-28-alignment-anker-design.md
git commit -m "test(anchors): measure whether ASR on a vocal stem yields anchors"
```

---

### Task 2: Transkriptionsstufe `transcribe.py`

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/transcribe.py`
- Create: `python-sidecar/tests/test_transcribe.py`

**Interfaces:**
- Consumes: `cache.stage_path`, `cache.atomic_write_bytes`, `progress.emit_progress`, `separate.STAGE_VERSION`, `separate.MODELL`.
- Produces:
  - `STAGE_VERSION: str`
  - `MODELL: str` — der ASR-Modellname
  - `@dataclass(frozen=True) TranskriptWort { text: str, start: float, ende: float }`
  - `transcribe(vocals: Path, sprache: str, work_dir: Path, audio_hash: str, device: str) -> list[TranskriptWort]`

- [ ] **Step 1: Write the failing test**

```python
# python-sidecar/tests/test_transcribe.py
import json
import sys
import types
from pathlib import Path

import pytest

from ultrastar_pipeline import separate, transcribe
from ultrastar_pipeline.cache import atomic_write_bytes, stage_path
from ultrastar_pipeline.transcribe import TranskriptWort


def _cache_pfad(work_dir: Path, audio_hash: str, sprache: str = "de") -> Path:
    return stage_path(
        work_dir,
        audio_hash,
        "transcribe",
        {
            "sprache": sprache,
            "modell": transcribe.MODELL,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        transcribe.STAGE_VERSION,
        ".json",
    )


def _platzhalter(zugriffe: list[str]) -> types.ModuleType:
    """Ein whisperx, das jeden Modellzugriff mitzaehlt statt eines zu laden."""

    def load_model(*args, **kwargs):
        zugriffe.append("load_model")
        raise RuntimeError("Platzhalter: dieser Test laedt kein Modell")

    modul = types.ModuleType("whisperx")
    modul.load_model = load_model
    return modul


def test_cache_treffer_kommt_ohne_modell_aus(tmp_path, monkeypatch):
    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    atomic_write_bytes(
        _cache_pfad(tmp_path, "hashA"),
        json.dumps([{"text": "eins", "start": 0.0, "ende": 0.5}]).encode("utf8"),
    )

    ergebnis = transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashA", "cpu")

    assert ergebnis == [TranskriptWort(text="eins", start=0.0, ende=0.5)]
    assert zugriffe == []


def test_separate_versionswechsel_invalidiert_den_transcribe_cache(tmp_path, monkeypatch):
    """Eine geaenderte Stimmtrennung darf kein Transkript des alten Stems
    wiederverwenden — sonst beschreibt das Transkript Audio, das es nie
    gesehen hat."""
    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    atomic_write_bytes(_cache_pfad(tmp_path, "hashB"), json.dumps([]).encode("utf8"))

    assert transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashB", "cpu") == []
    assert zugriffe == []

    monkeypatch.setattr(separate, "STAGE_VERSION", "999")
    with pytest.raises(RuntimeError):
        transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashB", "cpu")
    assert zugriffe == ["load_model"]
```

- [ ] **Step 2: Run test to verify it fails**

Run (aus `python-sidecar/`): `.venv312/Scripts/python.exe -m pytest tests/test_transcribe.py -v`
Expected: FAIL mit `ModuleNotFoundError: No module named 'ultrastar_pipeline.transcribe'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Freie Transkription der Gesangsspur. Duenner Adapter, keine Entscheidungen.

Zweck ist nicht der Text — den kennen wir bereits — sondern die Zeit: die
gehoerten Woerter liefern Ankerpunkte, gegen die der bekannte Liedtext
ausgerichtet werden kann.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from . import separate
from .cache import atomic_write_bytes, stage_path
from .progress import emit_progress

STAGE_VERSION = "1"
MODELL = "large-v2"


@dataclass(frozen=True)
class TranskriptWort:
    text: str
    start: float
    ende: float


def transcribe(
    vocals: Path, sprache: str, work_dir: Path, audio_hash: str, device: str
) -> list[TranskriptWort]:
    """Gehoerte Woerter mit Zeitstempeln."""
    # Die Identitaet der separate-Stufe geht in den Schluessel ein: ein
    # Transkript des alten Stems beschriebe Audio, das es nie gesehen hat.
    ziel = stage_path(
        work_dir,
        audio_hash,
        "transcribe",
        {
            "sprache": sprache,
            "modell": MODELL,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        gespeichert = json.loads(ziel.read_text(encoding="utf8"))
        emit_progress("transcribe", 1.0)
        return [TranskriptWort(**w) for w in gespeichert]

    emit_progress("transcribe", 0.0)
    import whisperx

    modell = whisperx.load_model(
        MODELL, device, compute_type="float16" if device == "cuda" else "int8"
    )
    ergebnis = modell.transcribe(str(vocals), language=sprache)

    # Segmenttexte werden ueber Leerzeichen zerlegt: fuer Anker zaehlt die
    # Wortfolge, nicht die Segmentgrenze. Die Segmentdauer wird gleichmaessig
    # auf die Woerter verteilt — die genaue Zeit liefert spaeter das Forced
    # Alignment, hier genuegt eine Naeherung mit korrekter Reihenfolge.
    woerter: list[TranskriptWort] = []
    for segment in ergebnis.get("segments", []):
        stuecke = str(segment.get("text", "")).split()
        if not stuecke:
            continue
        start = float(segment.get("start", 0.0))
        ende = float(segment.get("end", start))
        schritt = (ende - start) / len(stuecke)
        for i, stueck in enumerate(stuecke):
            woerter.append(
                TranskriptWort(
                    text=stueck,
                    start=start + i * schritt,
                    ende=start + (i + 1) * schritt,
                )
            )

    atomic_write_bytes(
        ziel, json.dumps([w.__dict__ for w in woerter], ensure_ascii=False).encode("utf8")
    )
    emit_progress("transcribe", 1.0)
    return woerter
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_transcribe.py -v`
Expected: PASS, beide Tests

- [ ] **Step 5: Fehlende ASR-Sprache unterscheidbar melden**

Die Spec verlangt, dass eine Sprache ohne ASR-Modell dieselbe Fehlerart wie eine Sprache ohne Alignment-Modell meldet, **aber mit der Stufe im Detail** — sonst ist die Ursache nicht unterscheidbar.

Test zuerst, in `tests/test_transcribe.py`:

```python
def test_fehlende_asr_sprache_nennt_die_stufe(tmp_path, monkeypatch):
    """LanguageUnsupported allein sagt nicht, welche Stufe kein Modell fand.
    Ohne die Stufe im Detail ist der Fehler fuer den Nutzer nicht zu deuten."""

    def load_model(*args, **kwargs):
        raise RuntimeError("kein Modell fuer diese Sprache")

    modul = types.ModuleType("whisperx")
    modul.load_model = load_model
    monkeypatch.setitem(sys.modules, "whisperx", modul)

    with pytest.raises(LanguageUnsupported) as fehler:
        transcribe.transcribe(Path("egal.wav"), "xx", tmp_path, "hashC", "cpu")
    assert fehler.value.language == "xx"
    assert fehler.value.stufe == "transcribe"
```

Dazu `LanguageUnsupported` in `align.py` um ein Stufenfeld erweitern und in `transcribe.py` importieren und verwenden:

```python
# in align.py
class LanguageUnsupported(Exception):
    """Fuer diese Sprache gibt es kein Modell der genannten Stufe."""

    def __init__(self, language: str, stufe: str = "align") -> None:
        super().__init__(f"{stufe}: {language}")
        self.language = language
        self.stufe = stufe
```

```python
# in transcribe.py, um den load_model-Aufruf
    try:
        modell = whisperx.load_model(
            MODELL, device, compute_type="float16" if device == "cuda" else "int8"
        )
    except Exception as exc:  # kein ASR-Modell fuer diese Sprache
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc
```

Der bestehende Aufruf in `align.py` bleibt gültig, weil `stufe` mit `"align"` vorbelegt ist. In `__main__.py` die Stufe ins Fehlerdetail aufnehmen, wo `LanguageUnsupported` behandelt wird.

Der Cache-Test aus Step 1 erwartet weiterhin `RuntimeError` — er benutzt einen Platzhalter, der vor dem `try` nicht greift. Läuft der Platzhalter in den `except`-Zweig, ist die Erwartung dort auf `LanguageUnsupported` zu ändern.

- [ ] **Step 6: Run all tests and commit**

Run: `.venv312/Scripts/python.exe -m pytest -q`
Expected: PASS, gesamte Suite

```bash
git add python-sidecar/ultrastar_pipeline/transcribe.py python-sidecar/ultrastar_pipeline/align.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/tests/test_transcribe.py
git commit -m "feat(sidecar): free transcription stage as an anchor source"
```

---

### Task 3: `anchors.py` — Normalisierung und monotones Matching

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/anchors.py`
- Create: `python-sidecar/tests/test_anchors.py`

**Interfaces:**
- Consumes: `transcribe.TranskriptWort` (Task 2).
- Produces:
  - `normalisiere(wort: str) -> str`
  - `@dataclass(frozen=True) Anchor { bekannter_index: int, zeit: float }`
  - `finde_anker(bekannte: list[str], gehoerte: list[TranskriptWort]) -> list[Anchor]`

- [ ] **Step 1: Write the failing test**

Der wichtigste Test ist der doppelte Refrain: er hätte den heutigen Fehler gefangen.

```python
# python-sidecar/tests/test_anchors.py
from ultrastar_pipeline.anchors import Anchor, finde_anker, normalisiere
from ultrastar_pipeline.transcribe import TranskriptWort


def _gehoert(woerter: list[str], schritt: float = 1.0) -> list[TranskriptWort]:
    return [
        TranskriptWort(text=w, start=i * schritt, ende=(i + 1) * schritt)
        for i, w in enumerate(woerter)
    ]


def test_normalisierung_entfernt_schreibweise_satzzeichen_und_diakritika():
    assert normalisiere("Cafe!") == "cafe"
    assert normalisiere("HALLO") == "hallo"
    assert normalisiere("wort,") == "wort"
    assert normalisiere("—") == ""


def test_identische_folgen_ergeben_einen_anker_je_wort():
    bekannte = ["eins", "zwei", "drei"]
    anker = finde_anker(bekannte, _gehoert(bekannte))
    assert [a.bekannter_index for a in anker] == [0, 1, 2]
    assert [a.zeit for a in anker] == [0.0, 1.0, 2.0]


def test_verhoertes_wort_faellt_heraus_ohne_die_nachbarn_zu_verlieren():
    bekannte = ["eins", "zwei", "drei"]
    anker = finde_anker(bekannte, _gehoert(["eins", "zwo", "drei"]))
    indizes = [a.bekannter_index for a in anker]
    assert 0 in indizes and 2 in indizes
    assert 1 not in indizes


def test_doppelter_refrain_ergibt_monotone_anker_ohne_rueckwaertssprung():
    """Der Test, der beim bisherigen Verfahren fehlgeschlagen waere: eine
    Refrainwiederholung darf nicht mit der frueheren verwechselt werden."""
    refrain = ["licht", "an", "heute"]
    bekannte = [*refrain, "strophe", *refrain]
    anker = finde_anker(bekannte, _gehoert([*refrain, "strophe", *refrain]))

    indizes = [a.bekannter_index for a in anker]
    zeiten = [a.zeit for a in anker]
    assert indizes == sorted(indizes) and len(set(indizes)) == len(indizes)
    assert zeiten == sorted(zeiten)
    # Der zweite Refrain muss spaet liegen, nicht auf die Zeit des ersten.
    spaete = [a.zeit for a in anker if a.bekannter_index >= 4]
    assert spaete and min(spaete) >= 4.0


def test_leeres_transkript_ergibt_keine_anker():
    assert finde_anker(["eins", "zwei"], []) == []


def test_leerer_liedtext_ergibt_keine_anker():
    assert finde_anker([], _gehoert(["eins"])) == []


def test_anker_sind_in_beiden_dimensionen_streng_steigend():
    """Die tragende Invariante des gesamten Entwurfs."""
    bekannte = ["a", "b", "c", "d", "e", "f", "a", "b", "c"]
    anker = finde_anker(bekannte, _gehoert(["a", "x", "c", "d", "e", "f", "a", "b", "c"]))
    for vorher, nachher in zip(anker, anker[1:]):
        assert nachher.bekannter_index > vorher.bekannter_index
        assert nachher.zeit > vorher.zeit
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: FAIL mit `ModuleNotFoundError: No module named 'ultrastar_pipeline.anchors'`

- [ ] **Step 3: Write minimal implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: PASS, alle sieben Tests

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/anchors.py python-sidecar/tests/test_anchors.py
git commit -m "feat(sidecar): monotone anchor matching between lyrics and transcript"
```

---

### Task 4: `anchors.py` — Abschnittsbildung und Vertrauensmaß

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/anchors.py`
- Modify: `python-sidecar/tests/test_anchors.py`

**Interfaces:**
- Consumes: `Anchor`, `finde_anker` (Task 3).
- Produces:
  - `@dataclass(frozen=True) Abschnitt { von_index: int, bis_index: int, start_s: float, ende_s: float, vertrauen: float, beidseitig_verankert: bool }` — `bis_index` ist exklusiv.
  - `baue_abschnitte(anzahl_woerter: int, anker: list[Anchor], dauer_s: float, zielgroesse: int = 12, saum_s: float = 0.3) -> list[Abschnitt]`

- [ ] **Step 1: Write the failing test**

```python
# ans Ende von tests/test_anchors.py
from ultrastar_pipeline.anchors import Abschnitt, baue_abschnitte


def test_ohne_anker_entsteht_ein_abschnitt_ueber_die_ganze_spur():
    """Der wichtigste Fall ist der schlechteste: ohne Anker faellt das
    Verfahren auf das bisherige Verhalten zurueck — sichtbar, nicht still."""
    abschnitte = baue_abschnitte(anzahl_woerter=10, anker=[], dauer_s=100.0)
    assert len(abschnitte) == 1
    a = abschnitte[0]
    assert (a.von_index, a.bis_index) == (0, 10)
    assert (a.start_s, a.ende_s) == (0.0, 100.0)
    assert a.vertrauen == 0.0
    assert a.beidseitig_verankert is False


def test_abschnitte_decken_alle_woerter_lueckenlos_und_ueberschneidungsfrei_ab():
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(40)]
    abschnitte = baue_abschnitte(40, anker, dauer_s=40.0, zielgroesse=12)

    assert abschnitte[0].von_index == 0
    assert abschnitte[-1].bis_index == 40
    for vorher, nachher in zip(abschnitte, abschnitte[1:]):
        assert nachher.von_index == vorher.bis_index


def test_zeitfenster_sind_lueckenlos_und_die_raender_verankert():
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(40)]
    abschnitte = baue_abschnitte(40, anker, dauer_s=50.0, zielgroesse=12, saum_s=0.3)

    assert abschnitte[0].start_s == 0.0
    assert abschnitte[-1].ende_s == 50.0
    for vorher, nachher in zip(abschnitte, abschnitte[1:]):
        # Ueberlappung als Sicherheitssaum ist gewollt, eine Luecke nicht.
        assert nachher.start_s <= vorher.ende_s


def test_vertrauen_ist_der_anteil_verankerter_woerter_im_abschnitt():
    # 20 Woerter, aber nur die erste Haelfte ist verankert.
    anker = [Anchor(bekannter_index=i, zeit=float(i)) for i in range(10)]
    abschnitte = baue_abschnitte(20, anker, dauer_s=30.0, zielgroesse=10)

    assert abschnitte[0].vertrauen > abschnitte[-1].vertrauen
    assert all(0.0 <= a.vertrauen <= 1.0 for a in abschnitte)


def test_ein_einziger_anker_ergibt_einen_einseitig_verankerten_abschnitt():
    abschnitte = baue_abschnitte(10, [Anchor(bekannter_index=0, zeit=2.0)], dauer_s=20.0)
    assert any(not a.beidseitig_verankert for a in abschnitte)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: FAIL mit `ImportError: cannot import name 'Abschnitt'`

- [ ] **Step 3: Write minimal implementation**

```python
# in anchors.py ergaenzen


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

    Ohne Anker entsteht genau ein Abschnitt ueber die volle Spur — bitweise
    das bisherige Verhalten. Das Verfahren kann damit nie schlechter werden
    als der gemessene Basiswert, sondern hoechstens sichtbar darauf
    zurueckfallen.
    """
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: PASS, alle zwölf Tests

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/anchors.py python-sidecar/tests/test_anchors.py
git commit -m "feat(sidecar): cut lyrics into anchored sections with a confidence"
```

---

### Task 5: `align.py` — ein Segment je Abschnitt

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/align.py`
- Modify: `python-sidecar/ultrastar_pipeline/__main__.py`
- Modify: `python-sidecar/tests/test_align.py`

**Interfaces:**
- Consumes: `anchors.Abschnitt` (Task 4), bestehende `zeilen_zuordnen`.
- Produces: `align(vocals, lines, language, work_dir, audio_hash, device, warnungen, abschnitte) -> list[AlignedWord]` — ein zusätzlicher Parameter am Ende, sonst unverändert.

- [ ] **Step 1: Write the failing test**

```python
# ans Ende von tests/test_align.py
from ultrastar_pipeline.anchors import Abschnitt


def test_je_abschnitt_entsteht_ein_segment_mit_eigenem_zeitfenster(tmp_path, monkeypatch):
    """Der Kern der Ueberarbeitung: nicht mehr ein Segment ueber die ganze
    Aufnahme, sondern eines je Abschnitt — sonst verteilt der Aligner den
    Text blind ueber die volle Laenge."""
    gesehen: list[list[dict]] = []

    def load_align_model(language_code, device):
        return object(), {}

    def align_stub(segmente, modell, metadaten, audio, device, return_char_alignments):
        gesehen.append(segmente)
        return {
            "segments": [
                {
                    "words": [
                        {"word": w, "start": float(i), "end": float(i) + 0.5, "score": 0.9}
                        for i, w in enumerate(str(s["text"]).split())
                    ]
                }
                for s in segmente
            ]
        }

    platzhalter = types.ModuleType("whisperx")
    platzhalter.load_align_model = load_align_model
    platzhalter.align = align_stub
    monkeypatch.setitem(sys.modules, "whisperx", platzhalter)

    lines = ["eins zwei", "drei vier"]
    abschnitte = [
        Abschnitt(0, 2, 0.0, 5.0, 1.0, False),
        Abschnitt(2, 4, 4.7, 10.0, 1.0, False),
    ]
    align(Path("egal.wav"), lines, "de", tmp_path, "hashSeg", "cpu", [], abschnitte)

    assert len(gesehen) == 1, "ein einziger Modellaufruf, wie bisher"
    segmente = gesehen[0]
    assert len(segmente) == 2
    assert (segmente[0]["start"], segmente[0]["end"]) == (0.0, 5.0)
    assert (segmente[1]["start"], segmente[1]["end"]) == (4.7, 10.0)
    assert segmente[0]["text"] == "eins zwei"
    assert segmente[1]["text"] == "drei vier"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv312/Scripts/python.exe -m pytest tests/test_align.py::test_je_abschnitt_entsteht_ein_segment_mit_eigenem_zeitfenster -v`
Expected: FAIL — `align()` nimmt kein `abschnitte`-Argument

- [ ] **Step 3: Write minimal implementation**

In `align.py`: Import `from .anchors import Abschnitt` ergänzen, Signatur um `abschnitte: list[Abschnitt]` erweitern, und den bisherigen Einzelsegment-Aufbau ersetzen:

```python
    # Ein Segment je Abschnitt statt eines ueber die ganze Aufnahme. Der
    # bisherige Ansatz liess den Aligner den Text blind ueber die volle
    # Laenge verteilen; gemessen ergab das lokales Verrutschen bis in den
    # Sekundenbereich (Zehntel-Mittel bis 2827 ms).
    flach = [wort for zeile in lines for wort in zeile.split()]
    segmente = [
        {
            "text": " ".join(flach[a.von_index : a.bis_index]),
            "start": a.start_s,
            "end": a.ende_s,
        }
        for a in abschnitte
        if flach[a.von_index : a.bis_index]
    ]
    if not segmente:
        segmente = [
            {"text": " ".join(lines), "start": 0.0, "end": dauer_sekunden(vocals)}
        ]
```

Ausserdem den Cache-Schlüssel um die Abschnittsstruktur erweitern — sonst liefert ein Treffer eine Ausrichtung nach altem Schnitt:

```python
    abschnitt_digest = hashlib.sha256(
        json.dumps(
            [[a.von_index, a.bis_index, a.start_s, a.ende_s] for a in abschnitte]
        ).encode("utf8")
    ).hexdigest()[:16]
```

und `"abschnitte": abschnitt_digest` in das Parameter-Dict von `stage_path` aufnehmen.

- [ ] **Step 4: Bestehende Aufrufe anpassen**

Die vorhandenen Cache-Tests in `test_align.py` rufen `align()` ohne `abschnitte` auf; dort eine leere Liste ergänzen. In `__main__.py` die Transkriptionsstufe zwischen `separate` und `align` einhängen, Anker und Abschnitte bilden und übergeben:

```python
    transkript = transcribe.transcribe(vocals, args.language, args.work_dir, fingerprint, device)
    flach = [wort for zeile in zeilen for wort in zeile.split()]
    anker = anchors.finde_anker(flach, transkript)
    abschnitte = anchors.baue_abschnitte(
        len(flach), anker, dauer_oder_rueckfall(vocals, 0.0)
    )
    # Ein schwacher Abschnitt darf nicht still bleiben.
    schwach = [a for a in abschnitte if a.vertrauen < 0.5]
    if schwach:
        warnungen.append(
            f"{len(schwach)} von {len(abschnitte)} Abschnitten konnten nur unsicher "
            "verankert werden; die Zeitstempel dort sind weniger verlaesslich."
        )
```

- [ ] **Step 5: Run all tests and commit**

Run: `.venv312/Scripts/python.exe -m pytest -q`
Expected: PASS, gesamte Suite

```bash
git add python-sidecar/ultrastar_pipeline/align.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/tests/test_align.py
git commit -m "feat(sidecar): align one segment per anchored section"
```

---

### Task 6: Vertrag um `sections` erweitern

**Files:**
- Modify: `python-sidecar/ultrastar_pipeline/__main__.py`
- Modify: `src/core/create/songData.ts`
- Modify: `src/core/create/songData.test.ts`

**Interfaces:**
- Consumes: `Abschnitt` (Task 4), Notenindizes aus `notes.py`.
- Produces: `sections: { fromNoteIndex: number, toNoteIndex: number, confidence: number, anchoredBothSides: boolean }[]` im Vertrag, Vertragsversion um eins erhöht. `toNoteIndex` ist exklusiv.

- [ ] **Step 1: Write the failing test**

Der Bereichsbezug muss geprüft werden — der bestehende Vertrag lässt `lineBreaks[].afterNoteIndex` ausserhalb des Bereichs still durchrutschen, und dieser dokumentierte Fehler wird nicht wiederholt.

```typescript
// in src/core/create/songData.test.ts
test("sections mit Index ausserhalb der Notenanzahl werden abgelehnt", () => {
  const roh = {
    ...gueltigeBasis(),
    sections: [{ fromNoteIndex: 0, toNoteIndex: 999, confidence: 1, anchoredBothSides: true }],
  };
  expect(() => parseSongData(roh)).toThrow();
});

test("sections mit verdrehten Grenzen werden abgelehnt", () => {
  const roh = {
    ...gueltigeBasis(),
    sections: [{ fromNoteIndex: 3, toNoteIndex: 1, confidence: 1, anchoredBothSides: true }],
  };
  expect(() => parseSongData(roh)).toThrow();
});

test("confidence ausserhalb von 0..1 wird abgelehnt", () => {
  const roh = {
    ...gueltigeBasis(),
    sections: [{ fromNoteIndex: 0, toNoteIndex: 1, confidence: 1.5, anchoredBothSides: true }],
  };
  expect(() => parseSongData(roh)).toThrow();
});

test("fehlendes sections wird als leere Liste gelesen", () => {
  expect(parseSongData(gueltigeBasis()).sections).toEqual([]);
});
```

`gueltigeBasis()` ist der in dieser Datei bereits vorhandene Erzeuger eines gültigen Rohobjekts; falls er dort anders heisst, den bestehenden Namen verwenden.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/songData.test.ts`
Expected: FAIL — `sections` ist unbekannt, die Ablehnungen bleiben aus

- [ ] **Step 3: Write minimal implementation**

`sections` in Typ und handgeschriebene Validierung aufnehmen, dem Stil der bestehenden Prüfungen folgend:

```typescript
export type Section = {
  fromNoteIndex: number;
  toNoteIndex: number; // exklusiv
  confidence: number;
  anchoredBothSides: boolean;
};

// in parseSongData, nachdem notes validiert sind:
const sections: Section[] = [];
const rohSections = (roh as { sections?: unknown }).sections ?? [];
if (!Array.isArray(rohSections)) throw new Error("sections muss eine Liste sein");
for (const eintrag of rohSections) {
  const s = eintrag as Record<string, unknown>;
  const von = s.fromNoteIndex;
  const bis = s.toNoteIndex;
  const vertrauen = s.confidence;
  if (!Number.isInteger(von) || !Number.isInteger(bis)) {
    throw new Error("sections: fromNoteIndex und toNoteIndex muessen ganze Zahlen sein");
  }
  // Bereichspruefung: der bestehende Vertrag laesst lineBreaks[].afterNoteIndex
  // ausserhalb des Bereichs still durchrutschen. Hier nicht.
  if ((von as number) < 0 || (von as number) >= (bis as number) || (bis as number) > notes.length) {
    throw new Error(`sections: Bereich ${von}..${bis} liegt ausserhalb von 0..${notes.length}`);
  }
  if (typeof vertrauen !== "number" || !Number.isFinite(vertrauen) || vertrauen < 0 || vertrauen > 1) {
    throw new Error("sections: confidence muss eine Zahl in 0..1 sein");
  }
  if (typeof s.anchoredBothSides !== "boolean") {
    throw new Error("sections: anchoredBothSides muss ein Wahrheitswert sein");
  }
  sections.push({
    fromNoteIndex: von as number,
    toNoteIndex: bis as number,
    confidence: vertrauen,
    anchoredBothSides: s.anchoredBothSides,
  });
}
```

Fehlendes `sections` wird damit zu `[]`. Ausserdem die Vertragsversion um eins erhöhen und `sections` in den Rückgabetyp aufnehmen.

Auf der Python-Seite in `__main__.py` die Wortindizes der Abschnitte in Notenindizes umrechnen (jede Silbe ist eine Note; die Zuordnung Wort → Noten liegt beim Notenbau vor) und als `sections` mitschreiben.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src` und `.venv312/Scripts/python.exe -m pytest -q`
Expected: PASS, beide Suiten

- [ ] **Step 5: Commit**

```bash
git add src/core/create/songData.ts src/core/create/songData.test.ts python-sidecar/ultrastar_pipeline/__main__.py
git commit -m "feat(create): carry per-section confidence through the contract"
```

---

### Task 7: Messvorrichtung schärfen

**Files:**
- Modify: `src/core/create/evaluate.ts`
- Modify: `src/core/create/evaluate.test.ts`
- Modify: `scripts/evaluate-pipeline.ts`

**Interfaces:**
- Consumes: bestehendes `Metrics`, `compareToReference`.
- Produces: `Metrics` erhält `medianVersatzMs: number` (vorzeichenbehaftet) und `driftProfil: number[]` (Mittelwert je Zehntel, immer zehn Einträge).

**Begründung:** `compareToReference` nimmt heute den Absolutwert und kann einen konstanten Versatz nicht von lokalem Verrutschen unterscheiden. Diese Diagnose musste beim ersten Basiswert von Hand ausserhalb des Harness gerechnet werden.

- [ ] **Step 1: Write the failing test**

```typescript
// in src/core/create/evaluate.test.ts
const songMitOnsets = (onsets: number[]) => ({
  bpm: 60,
  gap: 0,
  syllables: onsets.map((onsetMs, i) => ({ syllable: `s${i}`, onsetMs, pitch: 0 })),
});

test("medianVersatzMs zeigt das Vorzeichen einer konstanten Verschiebung", () => {
  const referenz = songMitOnsets([1000, 2000, 3000]);
  expect(compareToReference(songMitOnsets([1200, 2200, 3200]), referenz).medianVersatzMs)
    .toBeCloseTo(200, 0);
  expect(compareToReference(songMitOnsets([800, 1800, 2800]), referenz).medianVersatzMs)
    .toBeCloseTo(-200, 0);
});

test("driftProfil bleibt bei konstantem Versatz flach", () => {
  const onsets = Array.from({ length: 100 }, (_, i) => i * 1000);
  const referenz = songMitOnsets(onsets);
  const konstant = songMitOnsets(onsets.map((o) => o + 200));
  const profil = compareToReference(konstant, referenz).driftProfil;

  expect(profil).toHaveLength(10);
  expect(Math.max(...profil) - Math.min(...profil)).toBeLessThan(50);
});

test("driftProfil zeigt lokales Verrutschen als Ausschlag", () => {
  const onsets = Array.from({ length: 100 }, (_, i) => i * 1000);
  const referenz = songMitOnsets(onsets);
  // Nur das letzte Zehntel verrutscht.
  const verrutscht = songMitOnsets(onsets.map((o, i) => (i >= 90 ? o + 3000 : o)));
  const profil = compareToReference(verrutscht, referenz).driftProfil;

  expect(profil[9]).toBeGreaterThan(2000);
  expect(profil[0]).toBeLessThan(50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/evaluate.test.ts`
Expected: FAIL — `medianVersatzMs` und `driftProfil` existieren nicht

- [ ] **Step 3: Write minimal implementation**

In `compareToReference` neben den absoluten auch die signierten Differenzen sammeln:

```typescript
// in der bestehenden Paarschleife, neben abweichungen.push(Math.abs(...)):
versatz.push((unser.syllables[i]?.onsetMs ?? 0) - (referenz.syllables[i]?.onsetMs ?? 0));

// nach der Schleife:
const medianVersatzMs = quantil(versatz, 0.5);

// Zehn Abschnitte fester Laenge: das Profil bleibt zwischen Songs
// vergleichbar, unabhaengig von der Silbenzahl.
const mittel = (a: number[]): number =>
  a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length;
const breite = versatz.length / 10;
const driftProfil = Array.from({ length: 10 }, (_, k) =>
  mittel(versatz.slice(Math.floor(k * breite), Math.floor((k + 1) * breite))),
);
```

`mittel` liefert für einen leeren Abschnitt `0`, sodass die Länge auch bei weniger als zehn Paaren stets zehn beträgt.

Im Bericht von `scripts/evaluate-pipeline.ts` beide Werte ausgeben: `medianVersatzMs` als eigene Spalte, das Driftprofil als Zahlenreihe unter der Tabelle.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/create/evaluate.ts src/core/create/evaluate.test.ts scripts/evaluate-pipeline.ts
git commit -m "feat(create): report signed offset and drift profile"
```

---

### Task 8: Basiswert über 30+ Songs messen und festschreiben

**Files:**
- Modify: `scripts/reference-corpus.json` (git-ignoriert, lokal)
- Modify: `docs/superpowers/specs/2026-07-28-alignment-anker-design.md`

- [ ] **Step 1: Korpus zusammenstellen**

30+ Songs aus `J:/Ultrastar` ins Manifest aufnehmen, bewusst gemischt nach Tempo, Gesangsdichte, instrumentalen Passagen und Refrainwiederholungen. Der bereits vermessene Song bleibt drin, damit der Vergleich zum alten Basiswert direkt ablesbar ist. Struktur je Eintrag: `{ "artist": ..., "title": ..., "songDir": ... }`.

- [ ] **Step 2: Messlauf**

Run:
```bash
PIPELINE_PYTHON=<absoluter-pfad>/python-sidecar/.venv312/Scripts/python.exe \
  bun run scripts/evaluate-pipeline.ts scripts/reference-corpus.json
```

Der Lauf dauert erheblich — Stimmtrennung und Transkription je Song. Für den bereits gelaufenen Song ist die Stimmtrennung gecacht.

- [ ] **Step 3: Ergebnis gegen die Zielmarke halten**

**80 % der Silben unter 50 ms.** Wird sie verfehlt, ist das ein Befund und kein Grund, die Marke zu senken: Ergebnis mit Zahlen dem Nutzer vorlegen. Das Driftprofil aus Task 7 sagt dann, ob noch verrutscht wird oder ob ein anderer Fehler übrig ist. Mögliche Stellschraube ohne Entwurfsänderung: `zielgroesse` in `baue_abschnitte`. Sie ist zu messen, nicht zu raten — mindestens drei Werte (etwa 8, 12, 20) gegen denselben Korpus vergleichen und den besten festschreiben.

- [ ] **Step 4: Festschreiben und committen**

Nachtrag ans Design-Dokument mit Ergebnistabelle, Vergleich zum alten Basiswert (5 % unter 50 ms, Median 333 ms), gewählter Abschnittsgrösse und der gemessenen Ankerausbeute aus Task 1.

```bash
git add docs/superpowers/specs/2026-07-28-alignment-anker-design.md
git commit -m "docs: record the anchored-alignment baseline over the reference corpus"
```

---

## Nach dem Plan

Abschluss über `superpowers:finishing-a-development-branch`.

**Offen bleibt bewusst:** Duette, Sprachen ohne WhisperX-Alignment, ein persistenter Worker mit vorgehaltenen Modellen, Verbesserungen an Tonhöhe (heute 46 % exakt) und Silbentrennung, sowie die Umgebungsverwaltung aus Teilprojekt 2.
