# Persistenter Sidecar-Worker + TS-Orchestrierung — Implementation Plan (Teilprojekt 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Songs entstehen über eine Queue im Desktop-Main mit einem langlebigen Python-Worker (warme Modelle, Idle-Shutdown nach 5 min), abbrechbar, mit denselben typisierten Fehlern wie `runPipeline`.

**Architecture:** Der Verarbeitungskern von `__main__.py` wandert in ein geteiltes Modul (`verarbeitung.py`), das CLI und der neue `--worker`-Modus (stdin-JSON-Zeilen, `@@READY`/`@@JOB`-Marker) identisch nutzen; Modul-Level-Modellcaches machen den Worker wirklich warm. TS-seitig kapselt `SidecarWorker` (core) den Prozess mit Zeilen-Demux, Kill-basiertem Abbruch und Idle-Timer; `creations.ts` (desktop/main) orchestriert die In-Memory-Queue nach dem `downloads.ts`-Muster.

**Tech Stack:** Python 3.12 (Sidecar), TypeScript/Bun + Effect (core), Electron IPC (desktop).

Spec: `docs/superpowers/specs/2026-07-30-worker-orchestrierung-design.md`.

## Global Constraints

- Repo: `C:/Users/norma/Documents/Codeprojekte/UltraStar-CLI`, Basis `main` (a1c723b). Ausführung in einem isolierten Worktree/Branch gemäß superpowers:using-git-worktrees.
- **TypeScript-Kommentare Englisch**, Dateinamen camelCase. **Python Deutsch ohne Umlaute, reines ASCII in neuem Code, LF** — Formprüfung je Task per Byte-Scan (`ord(c) > 127` auf allen neuen Zeilen), nie per Sichtprüfung.
- pytest im Worktree: aus dem `python-sidecar/`-Verzeichnis mit `"C:/Users/norma/Documents/Codeprojekte/UltraStar-CLI-pipeline-core/python-sidecar/.venv312/Scripts/python.exe" -m pytest -q` (Ausgangsstand 136 passed/1 deselected). TS: `bun test src` (Ausgang 180 pass), `bunx tsc --noEmit`.
- Protokoll-Marker exakt: `@@READY` (eine Zeile, ohne Payload), `@@JOB {"id": "...", "ok": true|false}`; Job-Zeilen-Felder exakt `id`, `audio`, `lyricsFile`, `language`, `out`, optional `bpm`, `device`, `workDir`, `syncedLyrics`. Bestehende Marker `@@PROGRESS `/`@@ERROR ` unverändert.
- Idle-Timeout Standardwert 300 000 ms; ein aktiver Job gleichzeitig; Abbruch = Prozessbaum killen (Muster `pipeline.ts`: Windows `taskkill /pid <pid> /t /f`, POSIX `process.kill(-pid)`); drei Worker-Crashs in Folge pausieren die Queue.
- Umgebungs-Gate: `missing`/`broken` blockieren Queue-Start mit Fehler-Event; `outdated` läuft mit Warnung.
- Tests nie gegen echtes Python/GPU/Netz: Python-Kern gestubbt (monkeypatch), TS gegen Fake-Sidecar-Skripte bzw. injizierte Worker/Timer.
- Keine neuen Dependencies. Keine echten Songtexte in Code/Tests/Berichten.
- Kleine, dokumentierte Spec-Ergänzung: `CreateJobRequest` erhält zusätzlich `artist?: string; title?: string` (reine Anzeige in `CreationEntry`; die Spec nennt die Felder in `CreationEntry`, ließ ihre Quelle aber offen).

---

### Task 1: Verarbeitungskern extrahieren (`verarbeitung.py`)

Reiner Umzug ohne Verhaltensänderung: der Kern von `main()` wird von CLI und Worker geteilt.

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/verarbeitung.py`
- Modify: `python-sidecar/ultrastar_pipeline/__main__.py`
- Modify: `python-sidecar/tests/test_cli.py` (nur Patch-Ziel eines Tests)

**Interfaces:**
- Produces (von Task 3 konsumiert):

```python
@dataclass(frozen=True)
class Auftrag:
    language: str
    out: Path
    audio: Path | None = None
    lyrics_file: Path | None = None
    bpm: float | None = None
    device: str = "auto"
    work_dir: Path = Path(".pipeline-cache")
    synced_lyrics: Path | None = None

def verarbeite_auftrag(auftrag: Auftrag) -> int: ...
```

  `verarbeite_auftrag` enthält ALLES aus dem heutigen `main()` ab den Datei-Checks (`if args.audio is None ...`) bis einschließlich `atomic_write_bytes(...)`/`return 0`, plus eine eigene `warnungen`-Liste und den `_waehle_device`-Aufruf am Anfang (statt `args.` überall `auftrag.`). Mit umziehen (unverändert samt Docstrings): `_waehle_device`, `_erkenne_bpm`, `_stage_versions`, `_wende_lrc_an`, `_baue_sections`, `UNGELOESTE_MARKER` und die zugehörigen Importe (inkl. der `STAGE_VERSION`-Aliase).

- `__main__.py` danach: Docstring + argparse + Preload-Zweig (nutzt `verarbeitung._waehle_device` mit eigener Warnliste) + `return verarbeite_auftrag(Auftrag(audio=args.audio, lyrics_file=args.lyrics_file, language=args.language, bpm=args.bpm, device=args.device, work_dir=args.work_dir, out=args.out, synced_lyrics=args.synced_lyrics))`. Für bestehende Tests re-exportiert `__main__.py`: `from .verarbeitung import _baue_sections, _wende_lrc_an` (test_cli greift darauf zu).

- [ ] **Step 1: Testanpassung zuerst.** Einzige bewusste Änderung an Bestandstests: `test_stage_versions_folgen_den_modulkonstanten` in `test_cli.py` patcht künftig das neue Modul:

```python
def test_stage_versions_folgen_den_modulkonstanten(monkeypatch):
    """_stage_versions() muss aus den Modulen lesen, nicht aus Literalen -
    sonst bumpt eine Aenderung von align.STAGE_VERSION den Bericht nicht.
    Seit dem Worker-Umzug lebt der Kern in verarbeitung.py - dort patchen."""
    import ultrastar_pipeline.verarbeitung as verarbeitung

    monkeypatch.setattr(verarbeitung, "ALIGN_STAGE_VERSION", "77")
    assert verarbeitung._stage_versions()["align"] == "77"

    monkeypatch.setattr(verarbeitung, "TRANSCRIBE_STAGE_VERSION", "88")
    assert verarbeitung._stage_versions()["transcribe"] == "88"
```

- [ ] **Step 2: Umzug durchführen.** `verarbeitung.py` beginnt mit:

```python
"""Der geteilte Verarbeitungskern: ein Auftrag rein, song_data.json raus.

CLI (ein Auftrag pro Prozess) und Worker (viele Auftraege pro Prozess)
laufen durch exakt dieselbe Funktion - gleiche Fehlerleitung, gleiche
@@PROGRESS/@@ERROR-Ausgaben, gleicher Vertrag. Getrennt von __main__.py,
damit der Worker den Kern importieren kann, ohne das CLI-Modul doppelt
zu laden (python -m laedt __main__ unter anderem Namen).
"""
```

  Danach die umgezogenen Bestandteile 1:1, `Auftrag` und `verarbeite_auftrag` wie oben. In `__main__.py` bleiben nur Docstring, Imports, argparse, Preload-Zweig, Aufruf, `if __name__ == "__main__"` — plus die Re-Exporte.

- [ ] **Step 3: Grün belegen.** Komplette Suite: 136 passed/1 deselected (unverändert — der angepasste Test ersetzt seinen Vorgänger 1:1). Byte-Scan über beide geänderten .py-Dateien: keine neuen Nicht-ASCII-Zeilen.

- [ ] **Step 4: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/verarbeitung.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/tests/test_cli.py
git commit -m "refactor(sidecar): extract shared job core for cli and worker"
```

---

### Task 2: Modell-Caches (`modelle.py`)

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/modelle.py`
- Modify: `python-sidecar/ultrastar_pipeline/transcribe.py`, `align.py`, `separate.py`, `pitch.py`, `preload.py` (nur die Ladezeilen)
- Test: `python-sidecar/tests/test_modelle.py` (neu)

**Interfaces:**
- Produces:

```python
def hole_asr(modell: str, device: str, sprache: str): ...
def hole_align(sprache: str, device: str): ...      # -> (modell, metadaten)
def hole_demucs(name: str): ...
def hole_swiftf0(): ...
def leere_caches() -> None: ...                      # nur fuer Tests
```

- [ ] **Step 1: Failing Tests** — `python-sidecar/tests/test_modelle.py`:

```python
import sys
import types

import pytest

from ultrastar_pipeline import modelle


@pytest.fixture(autouse=True)
def frische_caches():
    modelle.leere_caches()
    yield
    modelle.leere_caches()


def _whisperx_zaehler(monkeypatch, ladungen: list[str]) -> None:
    modul = types.ModuleType("whisperx")
    modul.load_model = lambda name, device, compute_type, language: ladungen.append(
        f"asr:{name}:{device}:{language}"
    ) or object()
    modul.load_align_model = lambda language_code, device: ladungen.append(
        f"align:{language_code}:{device}"
    ) or (object(), {})
    monkeypatch.setitem(sys.modules, "whisperx", modul)


def test_asr_wird_je_schluessel_nur_einmal_geladen(monkeypatch):
    ladungen: list[str] = []
    _whisperx_zaehler(monkeypatch, ladungen)
    a = modelle.hole_asr("large-v2", "cpu", "de")
    b = modelle.hole_asr("large-v2", "cpu", "de")
    assert a is b
    assert ladungen == ["asr:large-v2:cpu:de"]


def test_verschiedene_schluessel_laden_getrennt(monkeypatch):
    ladungen: list[str] = []
    _whisperx_zaehler(monkeypatch, ladungen)
    modelle.hole_asr("large-v2", "cpu", "de")
    modelle.hole_asr("large-v2", "cpu", "en")
    modelle.hole_align("de", "cpu")
    modelle.hole_align("de", "cpu")
    assert ladungen == ["asr:large-v2:cpu:de", "asr:large-v2:cpu:en", "align:de:cpu"]


def test_demucs_und_swiftf0_cachen(monkeypatch):
    demucs_ladungen: list[str] = []
    demucs_pretrained = types.ModuleType("demucs.pretrained")
    demucs_pretrained.get_model = lambda name: demucs_ladungen.append(name) or object()
    monkeypatch.setitem(sys.modules, "demucs", types.ModuleType("demucs"))
    monkeypatch.setitem(sys.modules, "demucs.pretrained", demucs_pretrained)
    swift_ladungen: list[int] = []
    swift = types.ModuleType("swift_f0")
    swift.SwiftF0 = lambda: swift_ladungen.append(1) or object()
    monkeypatch.setitem(sys.modules, "swift_f0", swift)

    assert modelle.hole_demucs("htdemucs") is modelle.hole_demucs("htdemucs")
    assert modelle.hole_swiftf0() is modelle.hole_swiftf0()
    assert demucs_ladungen == ["htdemucs"]
    assert swift_ladungen == [1]
```

- [ ] **Step 2: Fehlschlag belegen** — `<venv-python> -m pytest tests/test_modelle.py -v`: FAIL (Modul fehlt).

- [ ] **Step 3: Implementierung** — `python-sidecar/ultrastar_pipeline/modelle.py`:

```python
"""Modul-Level-Caches fuer Modell-Handles.

Im Ein-Auftrag-CLI ist das Neuladen je Aufruf egal - der Prozess stirbt
danach. Im Worker (viele Auftraege pro Prozess) ist genau dieses Cachen
der Kern des Warm-Vorteils: ab dem zweiten Song entfallen 30-60 s
Ladezeit. Muster aus UltraStarKaraokeMaker (MIT, (c) walterfr).

Die Modelle sind zwischen Auftraegen zustandslos (transcribe/align halten
nichts vom vorherigen Song), darum ist das Cachen gefahrlos.
"""

from typing import Any

_asr: dict[tuple[str, str, str], Any] = {}
_align: dict[tuple[str, str], Any] = {}
_demucs: dict[str, Any] = {}
_swiftf0: list[Any] = []


def hole_asr(modell: str, device: str, sprache: str) -> Any:
    schluessel = (modell, device, sprache)
    if schluessel not in _asr:
        import whisperx

        _asr[schluessel] = whisperx.load_model(
            modell,
            device,
            compute_type="float16" if device == "cuda" else "int8",
            language=sprache,
        )
    return _asr[schluessel]


def hole_align(sprache: str, device: str) -> Any:
    schluessel = (sprache, device)
    if schluessel not in _align:
        import whisperx

        _align[schluessel] = whisperx.load_align_model(
            language_code=sprache, device=device
        )
    return _align[schluessel]


def hole_demucs(name: str) -> Any:
    if name not in _demucs:
        from demucs.pretrained import get_model

        _demucs[name] = get_model(name)
    return _demucs[name]


def hole_swiftf0() -> Any:
    if not _swiftf0:
        from swift_f0 import SwiftF0

        _swiftf0.append(SwiftF0())
    return _swiftf0[0]


def leere_caches() -> None:
    """Nur fuer Tests: haelt die Testlaeufe unabhaengig voneinander."""
    _asr.clear()
    _align.clear()
    _demucs.clear()
    _swiftf0.clear()
```

- [ ] **Step 4: Stufen umstellen.** Jede Ladezeile wird ein `modelle.hole_*`-Aufruf; die umgebende Fehlerbehandlung (LanguageUnsupported/OOM-Härtung) bleibt exakt stehen:
  - `transcribe.py`: `whisperx.load_model(...)` → `modelle.hole_asr(MODELL, device, sprache)`; `whisperx.load_align_model(...)` → `modelle.hole_align(sprache, device)` (Tupel entpacken wie bisher). Der `import whisperx` im Funktionskörper bleibt für `whisperx.align(...)`.
  - `align.py`: `whisperx.load_align_model(...)` → `modelle.hole_align(language, device)`.
  - `separate.py`: `get_model(MODELL)` → `modelle.hole_demucs(MODELL)`; `modell.to(device)`/`eval()` bleiben (idempotent).
  - `pitch.py`: `SwiftF0()` → `modelle.hole_swiftf0()`.
  - `preload.py`: alle vier Ladezeilen auf `modelle.hole_*` — Preload und echter Lauf wärmen damit DIESELBEN Caches.
  Bestehende Stufen-Tests stubben `whisperx`/`demucs`/`swift_f0` via `sys.modules`; die Cache-Indirektion ändert daran nichts (Imports passieren in `modelle.py` ebenso lazy). Falls ein Bestandstest nun einen Cache-Treffer statt eines Stub-Aufrufs sieht: `modelle.leere_caches()` im Setup des betroffenen Tests ergänzen und im Bericht dokumentieren, welche.

- [ ] **Step 5: Grün belegen.** Komplette Suite (Erwartung 139 passed/1 deselected). Byte-Scan über alle geänderten .py-Dateien.

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/modelle.py python-sidecar/ultrastar_pipeline/transcribe.py python-sidecar/ultrastar_pipeline/align.py python-sidecar/ultrastar_pipeline/separate.py python-sidecar/ultrastar_pipeline/pitch.py python-sidecar/ultrastar_pipeline/preload.py python-sidecar/tests/test_modelle.py
git commit -m "feat(sidecar): module-level model caches keep the worker warm"
```

---

### Task 3: Worker-Schleife (`worker.py` + `--worker`)

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/worker.py`
- Modify: `python-sidecar/ultrastar_pipeline/__main__.py`
- Test: `python-sidecar/tests/test_worker.py` (neu)

**Interfaces:**
- Consumes: `Auftrag`, `verarbeite_auftrag` (Task 1).
- Produces: `run_worker(eingang=None) -> int` (liest Zeilen von `eingang` bzw. `sys.stdin`); CLI-Flag `--worker` (macht `--language`/`--out` entbehrlich); Marker `@@READY` und `@@JOB {"id": ..., "ok": ...}` — Task 4 (TS) spricht genau dieses Protokoll.

- [ ] **Step 1: Failing Tests** — `python-sidecar/tests/test_worker.py`:

```python
import io
import json
import sys
from pathlib import Path

import ultrastar_pipeline.worker as worker
import ultrastar_pipeline.__main__ as haupt
from ultrastar_pipeline.worker import JOB_PREFIX, READY_MARKER


def _job(job_id: str, **extra) -> str:
    basis = {
        "id": job_id,
        "audio": "a.wav",
        "lyricsFile": "l.txt",
        "language": "de",
        "out": "o.json",
    }
    basis.update(extra)
    return json.dumps(basis)


def _job_zeilen(ausgabe: str) -> list[dict]:
    return [
        json.loads(z[len(JOB_PREFIX):])
        for z in ausgabe.splitlines()
        if z.startswith(JOB_PREFIX)
    ]


def test_ready_kommt_vor_dem_ersten_job(monkeypatch, capsys):
    monkeypatch.setattr(worker, "verarbeite_auftrag", lambda auftrag: 0)
    rc = worker.run_worker(io.StringIO(_job("j1") + "\n"))
    zeilen = capsys.readouterr().out.splitlines()
    assert rc == 0
    assert zeilen[0] == READY_MARKER
    assert _job_zeilen("\n".join(zeilen)) == [{"id": "j1", "ok": True}]


def test_fehlgeschlagener_auftrag_meldet_ok_false_und_der_worker_lebt_weiter(
    monkeypatch, capsys
):
    ergebnisse = iter([1, 0])
    monkeypatch.setattr(worker, "verarbeite_auftrag", lambda auftrag: next(ergebnisse))
    rc = worker.run_worker(io.StringIO(_job("schlecht") + "\n" + _job("gut") + "\n"))
    assert rc == 0
    assert _job_zeilen(capsys.readouterr().out) == [
        {"id": "schlecht", "ok": False},
        {"id": "gut", "ok": True},
    ]


def test_defekte_zeile_toetet_den_worker_nicht(monkeypatch, capsys):
    monkeypatch.setattr(worker, "verarbeite_auftrag", lambda auftrag: 0)
    rc = worker.run_worker(io.StringIO("kein json\n" + _job("j2") + "\n"))
    aus = capsys.readouterr().out
    assert rc == 0
    assert "@@ERROR" in aus
    assert _job_zeilen(aus) == [{"id": "j2", "ok": True}]


def test_feldabbildung_bis_in_den_auftrag(monkeypatch, capsys):
    gesehen: list = []
    monkeypatch.setattr(
        worker, "verarbeite_auftrag", lambda auftrag: gesehen.append(auftrag) or 0
    )
    zeile = _job(
        "j3", bpm=120.5, syncedLyrics="s.lrc", workDir="cache", device="cpu"
    )
    worker.run_worker(io.StringIO(zeile + "\n"))
    a = gesehen[0]
    assert a.audio == Path("a.wav")
    assert a.lyrics_file == Path("l.txt")
    assert a.language == "de"
    assert a.out == Path("o.json")
    assert a.bpm == 120.5
    assert a.synced_lyrics == Path("s.lrc")
    assert a.work_dir == Path("cache")
    assert a.device == "cpu"


def test_cli_flag_startet_den_worker_ohne_language_und_out(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    rc = haupt.main(["--worker"])
    assert rc == 0
    assert READY_MARKER in capsys.readouterr().out


def test_cli_ohne_worker_verlangt_language_und_out(capsys):
    import pytest

    with pytest.raises(SystemExit) as ausgang:
        haupt.main([])
    assert ausgang.value.code == 2
```

Hinweis: der letzte Test ersetzt inhaltlich den bestehenden `test_fehlende_argumente_ergeben_exit_2` in `test_cli.py` NICHT — beide bleiben; der bestehende läuft als Subprozess und muss unverändert grün bleiben (argparse-Pflicht wird zu manueller `p.error`-Prüfung, Exit-Code bleibt 2).

- [ ] **Step 2: Fehlschlag belegen** — `<venv-python> -m pytest tests/test_worker.py -v`: FAIL (Modul fehlt).

- [ ] **Step 3: `worker.py` implementieren**

```python
"""Worker-Modus: viele Auftraege pro Prozess, Modelle bleiben warm.

Protokoll (Gegenstueck: src/core/create/worker.ts): je stdin-Zeile ein
Auftrag als JSON (Felder wie die CLI-Argumente, camelCase), @@READY nach
dem Start, @@JOB {"id", "ok"} je Auftragsende. Die bestehenden
@@PROGRESS/@@ERROR-Zeilen laufen unveraendert durch - der TS-Demux ordnet
sie dem gerade laufenden Auftrag zu. EOF auf stdin beendet den Worker
sauber. Eine defekte Zeile ist ein @@ERROR plus Weiterlaufen - der Worker
stirbt nicht an einem Tippfehler des Aufrufers.
"""

import json
import sys
from pathlib import Path

from .progress import emit_error
from .verarbeitung import Auftrag, verarbeite_auftrag

READY_MARKER = "@@READY"
JOB_PREFIX = "@@JOB "


def _zu_auftrag(job: dict) -> Auftrag:
    return Auftrag(
        language=str(job["language"]),
        out=Path(str(job["out"])),
        audio=Path(str(job["audio"])) if job.get("audio") else None,
        lyrics_file=Path(str(job["lyricsFile"])) if job.get("lyricsFile") else None,
        bpm=float(job["bpm"]) if job.get("bpm") is not None else None,
        device=str(job.get("device", "auto")),
        work_dir=Path(str(job.get("workDir", ".pipeline-cache"))),
        synced_lyrics=Path(str(job["syncedLyrics"])) if job.get("syncedLyrics") else None,
    )


def run_worker(eingang=None) -> int:
    """Liest Auftraege von `eingang` (Standard: stdin) bis EOF."""
    zeilen = eingang if eingang is not None else sys.stdin
    print(READY_MARKER, flush=True)
    for zeile in zeilen:
        zeile = zeile.strip()
        if not zeile:
            continue
        try:
            job = json.loads(zeile)
            job_id = str(job["id"])
        except (ValueError, KeyError) as exc:
            emit_error("pipeline_failed", detail=f"Unlesbarer Auftrag: {exc}")
            continue
        try:
            ok = verarbeite_auftrag(_zu_auftrag(job)) == 0
        except (ValueError, KeyError, TypeError) as exc:
            # verarbeite_auftrag faengt Pipeline-Fehler selbst; hier landen
            # nur unbrauchbare Feldwerte des Auftrags.
            emit_error("pipeline_failed", detail=f"Unbrauchbarer Auftrag {job_id}: {exc}")
            ok = False
        print(JOB_PREFIX + json.dumps({"id": job_id, "ok": ok}), flush=True)
    return 0
```

- [ ] **Step 4: `__main__.py` verdrahten.** `p.add_argument("--worker", action="store_true")`; `--language` und `--out` verlieren `required=True`; direkt nach `args = p.parse_args(argv)`:

```python
    if args.worker:
        from .worker import run_worker

        return run_worker()

    if args.language is None or args.out is None:
        p.error("--language und --out sind erforderlich (ausser mit --worker)")
```

Docstring um den Worker-Modus ergänzen. Der Preload-Zweig und alles Weitere bleiben unverändert dahinter.

- [ ] **Step 5: Grün belegen.** Komplette Suite (Erwartung 145 passed/1 deselected: 139 + 6 neue). Byte-Scan über die geänderten .py-Dateien.

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/worker.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/tests/test_worker.py
git commit -m "feat(sidecar): worker mode processes jobs from stdin"
```

---

### Task 4: TS-Worker-Client (`SidecarWorker`)

**Files:**
- Create: `src/core/create/worker.ts`
- Create: `src/core/create/processTree.ts` (Kill-Logik, aus `pipeline.ts` extrahiert)
- Modify: `src/core/create/pipeline.ts` (nutzt `killProcessTree`; exportiert `FEHLER_ABBILDUNG` und `baueDetail`)
- Test: `src/core/create/worker.test.ts` (neu)

**Interfaces:**
- Consumes: `resolvePythonBin` (TP2), `FEHLER_ABBILDUNG`/`baueDetail`/`PipelineError` aus `pipeline.ts`.
- Produces (von Task 5 konsumiert):

```typescript
export type WorkerJob = {
  id: string;
  audioPath: string;
  lyricsPath: string;
  language: string;
  outPath: string;
  bpm?: number;
  syncedLyricsPath?: string;
  workDir?: string;
  device?: "auto" | "cuda" | "cpu";
};
export type WorkerOptions = {
  pythonBin?: string;
  managedEnvDir?: string;
  idleMs?: number;          // default 300_000
  readyTimeoutMs?: number;  // default 120_000
  spawnFn?: typeof spawn;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};
export class SidecarWorker {
  constructor(opts?: WorkerOptions);
  isAlive(): boolean;
  submitJob(job: WorkerJob, onProgress?: (stage: string, percent: number) => void): Promise<void>;
  cancelCurrentJob(): void;   // rejects the running job with kind "Cancelled"
  shutdown(): Promise<void>;  // close stdin, wait for exit, kill fallback
}
```

  `processTree.ts`: `export const killProcessTree = (child: ChildProcess): void` — exakt die heutige `abbrechen`-Logik aus `pipeline.ts` (Windows `taskkill /pid <pid> /t /f` mit error-Listener, POSIX `process.kill(-pid, "SIGKILL")` mit Fallback `child.kill`).

- [ ] **Step 1: Failing Tests** — `src/core/create/worker.test.ts`. Fake-Sidecar, das stdin-Zeilen liest und geskriptete Antworten schreibt:

```typescript
// src/core/create/worker.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { SidecarWorker } from "./worker.ts";

const FAKE = `
console.log("@@READY");
const dec = new TextDecoder();
let puffer = "";
for await (const chunk of Bun.stdin.stream()) {
  puffer += dec.decode(chunk);
  const zeilen = puffer.split("\\n");
  puffer = zeilen.pop() ?? "";
  for (const zeile of zeilen) {
    if (!zeile.trim()) continue;
    const job = JSON.parse(zeile);
    console.log('@@PROGRESS {"stage":"separate","percent":0.5}');
    if (job.id === "fail") {
      console.log('@@ERROR {"kind":"alignment_failed","detail":"kaputt"}');
      console.log('@@JOB ' + JSON.stringify({ id: job.id, ok: false }));
    } else if (job.id === "crash") {
      process.exit(3);
    } else if (job.id === "slow") {
      await new Promise((r) => setTimeout(r, 5000));
      console.log('@@JOB ' + JSON.stringify({ id: job.id, ok: true }));
    } else {
      console.log('@@JOB ' + JSON.stringify({ id: job.id, ok: true }));
    }
  }
}
`;

const fakeWorkerBin = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "worker-test-"));
  const skript = join(dir, "fakeWorker.ts");
  await writeFile(skript, FAKE, "utf8");
  return skript;
};

const job = (id: string) => ({
  id,
  audioPath: "a.wav",
  lyricsPath: "l.txt",
  language: "de",
  outPath: "o.json",
});

describe("SidecarWorker", () => {
  it("verarbeitet einen Job und liefert Fortschritt", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    const stufen: string[] = [];
    await worker.submitJob(job("ok1"), (stage) => stufen.push(stage));
    expect(stufen).toContain("separate");
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("mappt @@ERROR auf typisierte Fehler", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    await expect(worker.submitJob(job("fail"))).rejects.toMatchObject({
      kind: "AlignmentFailed",
    });
    // Ein fachlicher Fehler toetet den Worker nicht.
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("meldet einen Crash als PipelineFailed und startet danach neu", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    await expect(worker.submitJob(job("crash"))).rejects.toMatchObject({
      kind: "PipelineFailed",
    });
    expect(worker.isAlive()).toBe(false);
    await worker.submitJob(job("ok2")); // transparenter Neustart
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("cancelCurrentJob bricht den laufenden Job ab und toetet den Worker", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    const laufend = worker.submitJob(job("slow"));
    await new Promise((r) => setTimeout(r, 300)); // Job ist angelaufen
    worker.cancelCurrentJob();
    await expect(laufend).rejects.toMatchObject({ kind: "Cancelled" });
    expect(worker.isAlive()).toBe(false);
  });

  it("faehrt nach dem Idle-Timeout herunter", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const worker = new SidecarWorker({
      pythonBin: await fakeWorkerBin(),
      idleMs: 12345,
      setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
      clearTimer: () => {},
    });
    await worker.submitJob(job("ok3"));
    const idle = timers.find((t) => t.ms === 12345);
    expect(idle).toBeDefined();
    idle?.fn();
    // Shutdown ist asynchron - kurz warten, dann muss der Prozess weg sein.
    await new Promise((r) => setTimeout(r, 500));
    expect(worker.isAlive()).toBe(false);
  });
});
```

- [ ] **Step 2: Fehlschlag belegen** — `bun test src/core/create/worker.test.ts`: FAIL (Module fehlen).

- [ ] **Step 3: `processTree.ts` extrahieren.** Neue Datei mit `killProcessTree(child)` (Logik wörtlich aus `pipeline.ts`s `abbrechen`, inkl. der Kommentare zum error-Listener und POSIX-Fallback); `pipeline.ts` ruft sie in `abbrechen` auf (Verhalten identisch, bestehende Tests bleiben grün). Zusätzlich in `pipeline.ts`: `export` vor `FEHLER_ABBILDUNG` und `baueDetail` (Doku-Kommentar: der Worker-Client mappt @@ERROR identisch).

- [ ] **Step 4: `SidecarWorker` implementieren** — `src/core/create/worker.ts`:

```typescript
// src/core/create/worker.ts
// Long-lived sidecar worker client. One process, many jobs, warm models;
// idle shutdown frees the GPU. Line demux mirrors runPipeline's marker
// protocol; job boundaries come from @@READY and @@JOB lines.
import { spawn, type ChildProcess } from "node:child_process";
import { resolvePythonBin } from "./environment.ts";
import {
  baueDetail,
  FEHLER_ABBILDUNG,
  type PipelineError,
} from "./pipeline.ts";
import { killProcessTree } from "./processTree.ts";

export type WorkerJob = {
  id: string;
  audioPath: string;
  lyricsPath: string;
  language: string;
  outPath: string;
  bpm?: number;
  syncedLyricsPath?: string;
  workDir?: string;
  device?: "auto" | "cuda" | "cpu";
};

export type WorkerOptions = {
  pythonBin?: string;
  managedEnvDir?: string;
  idleMs?: number;
  readyTimeoutMs?: number;
  spawnFn?: typeof spawn;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

type LaufenderJob = {
  id: string;
  resolve: () => void;
  reject: (fehler: PipelineError) => void;
  onProgress?: (stage: string, percent: number) => void;
  letzterFehler: PipelineError | null;
};

const READY = "@@READY";
const PROGRESS_PREFIX = "@@PROGRESS ";
const ERROR_PREFIX = "@@ERROR ";
const JOB_PREFIX = "@@JOB ";

export class SidecarWorker {
  private child: ChildProcess | null = null;
  private bereit: Promise<void> | null = null;
  private aktuell: LaufenderJob | null = null;
  private idleTimer: unknown = null;
  private stderrEnde = "";

  constructor(private readonly opts: WorkerOptions = {}) {}

  isAlive(): boolean {
    return this.child !== null;
  }

  async submitJob(
    job: WorkerJob,
    onProgress?: (stage: string, percent: number) => void,
  ): Promise<void> {
    if (this.aktuell) {
      throw { kind: "PipelineFailed", detail: "Es laeuft bereits ein Auftrag." } satisfies PipelineError;
    }
    this.stoppeIdleTimer();
    await this.starteFallsNoetig();
    return new Promise<void>((resolve, reject) => {
      this.aktuell = { id: job.id, resolve, reject, onProgress, letzterFehler: null };
      const zeile = JSON.stringify({
        id: job.id,
        audio: job.audioPath,
        lyricsFile: job.lyricsPath,
        language: job.language,
        out: job.outPath,
        bpm: job.bpm,
        device: job.device,
        workDir: job.workDir,
        syncedLyrics: job.syncedLyricsPath,
      });
      this.child?.stdin?.write(`${zeile}\n`);
    }).finally(() => {
      this.aktuell = null;
      this.starteIdleTimer();
    });
  }

  cancelCurrentJob(): void {
    if (!this.child) return;
    const laufend = this.aktuell;
    // Mid-Demucs there is nothing finer than killing the tree; the next
    // job pays one cold start. Mark dead first so the exit handler does
    // not double-report.
    const kind = this.child;
    this.child = null;
    this.bereit = null;
    killProcessTree(kind);
    laufend?.reject({ kind: "Cancelled" });
    this.aktuell = null;
  }

  async shutdown(): Promise<void> {
    this.stoppeIdleTimer();
    const kind = this.child;
    if (!kind) return;
    this.child = null;
    this.bereit = null;
    const beendet = new Promise<void>((resolve) => {
      kind.once("close", () => resolve());
    });
    kind.stdin?.end();
    // Grace period, then hard kill - a worker stuck in native code would
    // otherwise hold gigabytes of VRAM forever.
    const frist = (this.opts.setTimer ?? setTimeout)(
      () => killProcessTree(kind),
      5_000,
    );
    await beendet;
    (this.opts.clearTimer ?? clearTimeout)(frist as Parameters<typeof clearTimeout>[0]);
  }

  private async starteFallsNoetig(): Promise<void> {
    if (this.child) return this.bereit ?? undefined;
    const bin = resolvePythonBin(this.opts.pythonBin, this.opts.managedEnvDir);
    const [befehl, argumente] = bin.endsWith(".ts")
      ? (["bun", [bin, "--worker"]] as const)
      : ([bin, ["-m", "ultrastar_pipeline", "--worker"]] as const);
    const spawnFn = this.opts.spawnFn ?? spawn;
    const kind = spawnFn(befehl, [...argumente], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = kind;
    this.stderrEnde = "";

    let bereitGeworden!: () => void;
    let bereitGescheitert!: (fehler: PipelineError) => void;
    this.bereit = new Promise<void>((resolve, reject) => {
      bereitGeworden = resolve;
      bereitGescheitert = reject;
    });
    const readyFrist = (this.opts.setTimer ?? setTimeout)(() => {
      bereitGescheitert({
        kind: "PipelineFailed",
        detail: "Worker meldet sich nicht (READY-Timeout).",
      });
      this.cancelCurrentJob();
    }, this.opts.readyTimeoutMs ?? 120_000);

    let rest = "";
    kind.stdout?.setEncoding("utf8");
    kind.stdout?.on("data", (stueck: string) => {
      rest += stueck;
      const zeilen = rest.split("\n");
      rest = zeilen.pop() ?? "";
      for (const zeile of zeilen) this.verarbeiteZeile(zeile, bereitGeworden);
    });
    kind.stderr?.setEncoding("utf8");
    kind.stderr?.on("data", (s: string) => {
      this.stderrEnde = (this.stderrEnde + s).slice(-500);
    });
    kind.on("error", (fehler: Error) => {
      bereitGescheitert({ kind: "PipelineFailed", detail: fehler.message });
    });
    kind.on("close", (code) => {
      if (this.child === kind) {
        this.child = null;
        this.bereit = null;
        const laufend = this.aktuell;
        this.aktuell = null;
        laufend?.reject({
          kind: "PipelineFailed",
          detail: `Worker beendet (Exit ${code ?? "?"}). ${this.stderrEnde}`.trim(),
        });
      }
    });

    await this.bereit;
    (this.opts.clearTimer ?? clearTimeout)(readyFrist as Parameters<typeof clearTimeout>[0]);
  }

  private verarbeiteZeile(zeile: string, bereitGeworden: () => void): void {
    if (zeile.startsWith(READY)) {
      bereitGeworden();
      return;
    }
    if (zeile.startsWith(PROGRESS_PREFIX)) {
      try {
        const p = JSON.parse(zeile.slice(PROGRESS_PREFIX.length));
        this.aktuell?.onProgress?.(String(p.stage), Number(p.percent));
      } catch {
        // a garbled progress line is not a reason to abort
      }
      return;
    }
    if (zeile.startsWith(ERROR_PREFIX)) {
      try {
        const fehler = JSON.parse(zeile.slice(ERROR_PREFIX.length));
        if (this.aktuell) {
          this.aktuell.letzterFehler = {
            kind: FEHLER_ABBILDUNG[fehler.kind] ?? "PipelineFailed",
            detail: baueDetail(fehler),
          };
        }
      } catch {
        // see above
      }
      return;
    }
    if (zeile.startsWith(JOB_PREFIX)) {
      try {
        const ende = JSON.parse(zeile.slice(JOB_PREFIX.length));
        const laufend = this.aktuell;
        if (!laufend || ende.id !== laufend.id) return;
        if (ende.ok) {
          laufend.resolve();
        } else {
          laufend.reject(
            laufend.letzterFehler ?? {
              kind: "PipelineFailed",
              detail: "Auftrag fehlgeschlagen ohne Fehlermeldung.",
            },
          );
        }
      } catch {
        // see above
      }
    }
    // anything else is torch/demucs log noise - same policy as runPipeline
  }

  private starteIdleTimer(): void {
    this.stoppeIdleTimer();
    if (!this.child) return;
    const setTimer = this.opts.setTimer ?? setTimeout;
    this.idleTimer = setTimer(() => {
      void this.shutdown();
    }, this.opts.idleMs ?? 300_000);
  }

  private stoppeIdleTimer(): void {
    if (this.idleTimer !== null) {
      (this.opts.clearTimer ?? clearTimeout)(
        this.idleTimer as Parameters<typeof clearTimeout>[0],
      );
      this.idleTimer = null;
    }
  }
}
```

  Hinweis für den Implementer: Bun-Typen für `setTimeout`-Handles unterscheiden sich von Node — falls tsc an den Casts meckert, die Timer-Injektion auf `unknown` halten (wie oben) und nur an der Aufrufstelle casten.

- [ ] **Step 5: Grün belegen** — `bun test src` (Erwartung 185 pass: 180 + 5 neue), `bunx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/core/create/worker.ts src/core/create/processTree.ts src/core/create/pipeline.ts src/core/create/worker.test.ts
git commit -m "feat(create): sidecar worker client with idle shutdown"
```

---

### Task 5: Queue-Orchestrierung + IPC (`creations.ts`)

**Files:**
- Create: `src/desktop/main/creations.ts`
- Modify: `src/desktop/shared/ipcContract.ts`, `src/desktop/preload/index.ts`, `src/desktop/main/ipc.ts`, `src/desktop/main/index.ts` (will-quit)
- Test: `src/desktop/main/creations.test.ts` (neu; ohne electron-Import testbar durch Dependency-Injection)

**Interfaces:**
- Consumes: `SidecarWorker`/`WorkerJob` (Task 4), `environmentStatusForApp`, `managedEnvDir` (TP2), `broadcast` aus `state.ts`.
- Produces:
  - ipcContract: `CreateJobRequest { id: string; audioPath: string; lyricsPath: string; language: string; outPath: string; bpm?: number; syncedLyricsPath?: string; artist?: string; title?: string }`; `CreationEntry { id: string; artist?: string; title?: string; status: "queued" | "running" | "completed" | "failed"; stage?: string; progress?: number; error?: string }`; Invoke-Kanäle `create:queueAdd` (Param `CreateJobRequest[]`, Rückgabe Anzahl), `create:queueRemove` (Param id), `create:queueClear`, `create:start`, `create:cancel`; Event `event:creations` (`CreationEntry[]`); `UltrastarApi` + `createQueueAdd(jobs)`, `createQueueRemove(id)`, `createQueueClear()`, `createStart()`, `createCancel()`.
  - creations.ts: `createCreations(deps)` (Factory für Tests) und die vorverdrahtete App-Instanz:

```typescript
export type CreationsDeps = {
  newWorker: () => Pick<SidecarWorker, "submitJob" | "cancelCurrentJob" | "shutdown" | "isAlive">;
  environmentStatus: () => Promise<EnvironmentStatus>;
  broadcast: <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void;
};
export const createCreations = (deps: CreationsDeps) => ({
  queueAdd, queueRemove, queueClear, start, cancel, shutdown, entriesForTests,
});
```

  **Wichtig:** `creations.ts` bleibt electron-frei (nur type-only-Importe aus ipcContract und Worker-Typen) — sonst bräuchte der Test electron-Mocks. Die verdrahtete App-Instanz entsteht in `ipc.ts` (dort sind electron-Importe zuhause) und wird von dort exportiert; `index.ts` nutzt sie für `will-quit`.

- [ ] **Step 1: Failing Tests** — `src/desktop/main/creations.test.ts` (nur die Factory testen, keine electron-Importe):

```typescript
// src/desktop/main/creations.test.ts
import { describe, expect, it } from "bun:test";
import { createCreations, type CreationsDeps } from "./creations.ts";

type FakeVerhalten = "ok" | "fail" | "crash";

const fakeDeps = (opts?: {
  env?: "ready" | "missing" | "outdated";
  verhalten?: (id: string) => FakeVerhalten;
}) => {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const bearbeitet: string[] = [];
  let alive = false;
  const worker = {
    isAlive: () => alive,
    submitJob: async (job: { id: string }) => {
      alive = true;
      bearbeitet.push(job.id);
      const v = opts?.verhalten?.(job.id) ?? "ok";
      if (v === "fail") throw { kind: "AlignmentFailed", detail: "kaputt" };
      if (v === "crash") {
        alive = false;
        throw { kind: "PipelineFailed", detail: "Worker beendet (Exit 3)." };
      }
    },
    cancelCurrentJob: () => {
      alive = false;
    },
    shutdown: async () => {
      alive = false;
    },
  };
  const deps: CreationsDeps = {
    newWorker: () => worker,
    environmentStatus: async () => ({ state: opts?.env ?? "ready" }),
    broadcast: (channel, payload) => events.push({ channel, payload }),
  };
  return { deps, events, bearbeitet };
};

const job = (id: string) => ({
  id,
  audioPath: "a.wav",
  lyricsPath: "l.txt",
  language: "de",
  outPath: `${id}.json`,
});

describe("creations queue", () => {
  it("verarbeitet Jobs sequenziell und meldet Status", async () => {
    const { deps, events, bearbeitet } = fakeDeps();
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    await c.start();
    expect(bearbeitet).toEqual(["a", "b"]);
    const letzter = events.filter((e) => e.channel === "event:creations").at(-1)
      ?.payload as Array<{ id: string; status: string }>;
    expect(letzter.map((e) => e.status)).toEqual(["completed", "completed"]);
  });

  it("ein fachlicher Fehler stoppt die Queue nicht", async () => {
    const { deps, bearbeitet } = fakeDeps({
      verhalten: (id) => (id === "a" ? "fail" : "ok"),
    });
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    await c.start();
    expect(bearbeitet).toEqual(["a", "b"]);
    const eintraege = c.entriesForTests();
    expect(eintraege.find((e) => e.id === "a")?.status).toBe("failed");
    expect(eintraege.find((e) => e.id === "b")?.status).toBe("completed");
  });

  it("drei Crashs in Folge pausieren die Queue", async () => {
    const { deps, events, bearbeitet } = fakeDeps({ verhalten: () => "crash" });
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b"), job("c"), job("d")]);
    await c.start();
    expect(bearbeitet).toEqual(["a", "b", "c"]);
    expect(
      events.some(
        (e) =>
          e.channel === "event:error" &&
          String((e.payload as { message: string }).message).includes("pausiert"),
      ),
    ).toBe(true);
    expect(c.entriesForTests().find((e) => e.id === "d")?.status).toBe("queued");
  });

  it("blockiert ohne eingerichtete Umgebung", async () => {
    const { deps, events, bearbeitet } = fakeDeps({ env: "missing" });
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    expect(bearbeitet).toEqual([]);
    expect(events.some((e) => e.channel === "event:error")).toBe(true);
  });

  it("outdated laeuft mit Warnung weiter", async () => {
    const { deps, events, bearbeitet } = fakeDeps({ env: "outdated" });
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    expect(bearbeitet).toEqual(["a"]);
    expect(events.some((e) => e.channel === "event:error")).toBe(true); // Warnhinweis
  });

  it("queueRemove entfernt nur wartende Jobs", async () => {
    const { deps } = fakeDeps();
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    c.queueRemove("b");
    expect(c.entriesForTests().map((e) => e.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Fehlschlag belegen** — `bun test src/desktop/main/creations.test.ts`: FAIL.

- [ ] **Step 3: ipcContract/preload/ipc erweitern** (Muster TP2 Task 5): Typen + fünf Invoke-Kanäle + `event:creations` in `EventPayloads`; preload-Wrapper; ipc-Handler delegieren an die App-Instanz (`creations.queueAdd(...)` usw.). Die bestehenden Kanal-Schleifen-Tests decken die neuen Kanäle automatisch ab (in TP2 verifiziert); der Handler-Vollständigkeits-Test in `ipc.test.ts` erzwingt die Handler.

- [ ] **Step 4: `creations.ts` implementieren.** Kern (englische Kommentare; `CreationEntry`-Spiegel wird bei JEDER Mutation gebroadcastet):

```typescript
export const createCreations = (deps: CreationsDeps) => {
  let queue: CreateJobRequest[] = [];
  const eintraege = new Map<string, CreationEntry>();
  let running = false;
  let crashStreak = 0;
  let worker: ReturnType<CreationsDeps["newWorker"]> | null = null;

  const melde = (): void =>
    deps.broadcast("event:creations", [...eintraege.values()]);

  const queueAdd = (jobs: CreateJobRequest[]): number => {
    for (const j of jobs) {
      if (eintraege.has(j.id)) continue;
      queue.push(j);
      eintraege.set(j.id, { id: j.id, artist: j.artist, title: j.title, status: "queued" });
    }
    melde();
    return queue.length;
  };

  const queueRemove = (id: string): void => {
    queue = queue.filter((j) => j.id !== id);
    if (eintraege.get(id)?.status === "queued") eintraege.delete(id);
    melde();
  };

  const queueClear = (): void => {
    queue = [];
    for (const [id, e] of eintraege) if (e.status === "queued") eintraege.delete(id);
    melde();
  };

  const start = async (): Promise<void> => {
    if (running || queue.length === 0) return;
    const env = await deps.environmentStatus();
    if (env.state === "missing" || env.state === "broken") {
      deps.broadcast("event:error", {
        context: "erstellen",
        message: "KI-Umgebung ist nicht eingerichtet (Einstellungen -> KI-Umgebung).",
      });
      return;
    }
    if (env.state === "outdated") {
      deps.broadcast("event:error", {
        context: "warnung",
        message: "KI-Umgebung ist veraltet - Lauf mit alter Version (Einstellungen -> Aktualisieren).",
      });
    }
    running = true;
    crashStreak = 0;
    try {
      while (queue.length > 0) {
        const jobDef = queue.shift() as CreateJobRequest;
        const eintrag = eintraege.get(jobDef.id);
        if (!eintrag) continue;
        eintrag.status = "running";
        melde();
        worker ??= deps.newWorker();
        try {
          await worker.submitJob(toWorkerJob(jobDef), (stage, percent) => {
            eintrag.stage = stage;
            eintrag.progress = percent;
            melde();
          });
          eintrag.status = "completed";
          eintrag.progress = 1;
          crashStreak = 0;
        } catch (fehler) {
          eintrag.status = "failed";
          eintrag.error = fehlerText(fehler);
          // A worker that died mid-job counts towards the crash brake;
          // domain errors (worker still alive) do not.
          if (!worker.isAlive()) {
            worker = null;
            crashStreak += 1;
            if (crashStreak >= 3) {
              deps.broadcast("event:error", {
                context: "erstellen",
                message: "Drei Worker-Abstuerze in Folge - Queue pausiert.",
              });
              melde();
              return;
            }
          } else {
            crashStreak = 0;
          }
        }
        melde();
      }
    } finally {
      running = false;
    }
  };

  const cancel = (): void => {
    worker?.cancelCurrentJob();
    worker = null;
  };

  const shutdown = async (): Promise<void> => {
    queue = [];
    worker?.cancelCurrentJob();
    worker = null;
  };

  return { queueAdd, queueRemove, queueClear, start, cancel, shutdown,
    entriesForTests: () => [...eintraege.values()] };
};
```

  Dazu in `creations.ts`: `toWorkerJob` (Feld-Mapping `CreateJobRequest` → `WorkerJob`: audioPath/lyricsPath/outPath/syncedLyricsPath unverändert durchreichen, bpm/language/id ebenso) und `fehlerText` (`typeof fehler === "object" && "detail" in fehler ? String(detail ?? kind) : String(fehler)`).

  Die verdrahtete App-Instanz entsteht in `ipc.ts` (electron-frei bleibt creations.ts, siehe Interfaces):

```typescript
export const creations = createCreations({
  // TP2 final-review note: hand the managed environment to the worker,
  // otherwise the one-click setup stays unused.
  newWorker: () => new SidecarWorker({ managedEnvDir: managedEnvDir() }),
  environmentStatus: environmentStatusForApp,
  broadcast,
});
```

  In `desktop/main/index.ts`: `app.on("will-quit", () => { void creations.shutdown(); })` (Import aus `./ipc.ts`) mit englischem Kommentar (kein Python-Waise, der warmes VRAM hält).

- [ ] **Step 5: Grün belegen** — `bun test src` (Erwartung 191 pass: 185 + 6 neue), `bunx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/main/creations.ts src/desktop/main/creations.test.ts src/desktop/shared/ipcContract.ts src/desktop/preload/index.ts src/desktop/main/ipc.ts src/desktop/main/index.ts
git commit -m "feat(desktop): creation queue orchestrates the sidecar worker"
```

---

### Task 6: Durchstich — warme Modelle real gemessen (Controller, GPU)

Kein Subagent-Task: der Controller fuehrt den echten Lauf aus.

- [ ] **Step 1:** Wegwerf-Skript im Scratchpad (nutzt `SidecarWorker` direkt, `managedEnvDir` auf die TP2-venv): denselben Referenzsong als zwei Jobs mit jeweils FRISCHEM `workDir` einreihen und je Job die Wanddauer messen. Erwartung: Job 2 ist deutlich schneller (Modell-Ladezeit entfaellt; Rechenarbeit identisch, weil der Stufencache leer ist). Beide `song_data.json` sind vertragskonform und inhaltlich gleichwertig.
- [ ] **Step 2:** Bericht an den Nutzer: Dauer Job 1 vs. Job 2, VRAM-Verhalten (Idle-Shutdown nach 5 min beobachtbar via nvidia-smi optional), etwaige Auffaelligkeiten. Danach Abschluss ueber superpowers:finishing-a-development-branch.

---

## Ausfuehrungshinweise

- Reihenfolge strikt 1 → 6; jede Task laesst pytest, `bun test src` und `bunx tsc --noEmit` gruen zurueck.
- Task 4 und 5 sind die anspruchsvollsten (Prozess-Lifecycle bzw. Queue-Zustand) — Implementer auf einem Standard-Modell; 1-3 sind mit vollstaendigem Code spezifiziert (guenstigstes Modell), wobei Task 1 als reiner Umzug besonders sorgfaeltig gegen den Ist-Stand von __main__.py zu arbeiten hat.
- Task 6 erst nach Review-Abschluss von 1-5.

