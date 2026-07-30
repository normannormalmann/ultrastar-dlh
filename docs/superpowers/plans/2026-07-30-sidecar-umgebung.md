# Sidecar-Umgebung automatisch einrichten — Implementation Plan (Teilprojekt 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Klick in den Desktop-Settings (oder ein Dev-Skript) richtet die komplette Python-Umgebung des Sidecars ein — uv, Python 3.12, venv, Torch (GPU-erkannt, gepinnt), Sidecar-Paket, Modelle vorgeladen — und `runPipeline` findet sie von selbst.

**Architecture:** Reine Logik in `src/core/create/environment.ts` (injizierte Runner, Effect-API wie `runPipeline`), Desktop-Anbindung nach dem `binaries.ts`-Muster (IPC-Kanäle, Fortschritts-Broadcast, Install-Lock), plus `--preload`-Modus im Python-Sidecar als Probelauf. Statusquelle ist ein Manifest `env.json` im env-Ordner.

**Tech Stack:** TypeScript/Bun + Effect (core), Electron IPC (desktop), Python 3.12 (Sidecar), uv (Astral) als Bootstrapper.

Spec: `docs/superpowers/specs/2026-07-30-sidecar-umgebung-design.md`.

## Global Constraints

- Repo: `C:/Users/norma/Documents/Codeprojekte/UltraStar-CLI`, Basis `main` (afcc126). Ausführung in einem isolierten Worktree/Branch gemäß superpowers:using-git-worktrees.
- **TypeScript-Kommentare auf Englisch** (Projekt-`CLAUDE.md`), UI-Strings im Renderer **Deutsch**. Dateinamen camelCase, keine kebab-case-Neuzugänge.
- **Python:** Deutsch ohne Umlaute, reines ASCII in neuem Code, LF; Docstrings erklären das Warum. pytest im Worktree aufrufen als: aus dem `python-sidecar/`-Verzeichnis des Worktrees `"C:/Users/norma/Documents/Codeprojekte/UltraStar-CLI-pipeline-core/python-sidecar/.venv312/Scripts/python.exe" -m pytest -q` (die venv des alten Worktrees enthält pytest + num2words; das Paket wird über das Aufrufverzeichnis gefunden, kein `pip install -e` nötig).
- `src/core/` nutzt Effect für I/O (öffentliche API als `Effect.Effect<...>`, Muster `runPipeline`); `src/desktop/main/` bleibt plain-async und ruft `Effect.runPromise`.
- Keine neuen npm-Dependencies (`extract-zip` existiert bereits); keine `"latest"`-Versionen.
- Exakte Werte: Python `3.12`; Torch-Pins `torch==2.8.0+cu128 torchaudio==2.8.0+cu128` mit `--index-url https://download.pytorch.org/whl/cu128` (GPU) bzw. `torch==2.8.0+cpu torchaudio==2.8.0+cpu` mit `--index-url https://download.pytorch.org/whl/cpu`; uv-Download `https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip`; env-Ordnername `python-env`; Manifestdatei `env.json` mit `schemaVersion: 1`.
- Tests niemals gegen echtes Netz/uv/GPU: injizierte Runner (TS) bzw. `monkeypatch.setitem(sys.modules, ...)` (Python). Suiten am Ende jeder Task grün: `bun test src`, `bunx tsc --noEmit`, pytest (Ausgangsstand 132 passed/1 deselected, bun 160 pass).
- Statuswerte exakt: `"missing" | "broken" | "outdated" | "ready"`. Fortschritt exakt: `{ schritt, prozent: number | null, detail? }` mit `schritt` aus `"uv" | "venv" | "gpu" | "torch" | "sidecar" | "preload"`.

## Notizen / TO-DO (nicht Teil dieses Plans)

- **LRCLIB `/api/search`-Fallback in `src/core/create/lrclib.ts`** (Nutzerwunsch 2026-07-30): Wenn `/api/get` leer ausgeht, `GET https://lrclib.net/api/search?track_name=...&artist_name=...` aufrufen (live verifiziert: liefert Trefferliste mit `duration` und `syncedLyrics`), clientseitig nach `|duration - unsere Dauer|` filtern (Toleranz ±5 s), synced bevorzugen. Hebt die LRC-Abdeckung (Korpus: nur 15/30). Übersteuert bewusst den „nur exakter Get-Endpunkt"-Ausschluss der 1c-Spec — der LRC-Sanity-Deckel (`MAX_LRC_KONFLIKT_QUOTE = 0.5`) bleibt als Schutz. Umsetzen als eigener kleiner Task nach diesem Plan oder mit Teilprojekt 5.

---

### Task 1: Sidecar `--preload` — Modelle laden als Probelauf

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/preload.py`
- Modify: `python-sidecar/ultrastar_pipeline/__main__.py`
- Modify: `python-sidecar/ultrastar_pipeline/progress.py` (nur falls `PROGRESS_PREFIX` dort noch nicht benannt exportiert ist)
- Test: `python-sidecar/tests/test_preload.py` (neu)

**Interfaces:**
- Produces: CLI-Modus `python -m ultrastar_pipeline --preload --language <sp> --out <pfad> [--device auto|cuda|cpu]` — lädt Demucs, Whisper-ASR, Alignment-Modell der Sprache und SwiftF0 je einmal, meldet `@@PROGRESS` mit den Stufen `preload:demucs`, `preload:asr`, `preload:align`, `preload:pitch` (je 0.0 und 1.0) und schreibt `{"device": "cuda"|"cpu", "modelle": {"demucs": "htdemucs", "asr": "large-v2", "align": "<sprache>", "pitch": "swift-f0"}}` nach `--out`. Exit 0 bei Erfolg; Fehler laufen durch die bestehende Fehlerleitung (`language_unsupported`, `device_error`, `env_missing`, `pipeline_failed`). Task 3 (TS) spawnt genau diesen Aufruf.

- [ ] **Step 1: Failing Tests schreiben** — `python-sidecar/tests/test_preload.py`:

```python
import json
import sys
import types
from pathlib import Path

import ultrastar_pipeline.__main__ as haupt
from ultrastar_pipeline.progress import PROGRESS_PREFIX


def _stub_module(name: str, **attrs) -> types.ModuleType:
    modul = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(modul, k, v)
    return modul


def _installiere_modell_stubs(monkeypatch, geladen: list[str]) -> None:
    """Alle vier Modellquellen als Platzhalter, die nur mitzaehlen."""
    monkeypatch.setitem(
        sys.modules, "torch",
        _stub_module("torch", cuda=_stub_module("cuda", is_available=lambda: False)),
    )
    demucs_pretrained = _stub_module(
        "demucs.pretrained", get_model=lambda name: geladen.append(f"demucs:{name}")
    )
    monkeypatch.setitem(sys.modules, "demucs", _stub_module("demucs"))
    monkeypatch.setitem(sys.modules, "demucs.pretrained", demucs_pretrained)
    whisperx = _stub_module(
        "whisperx",
        load_model=lambda *a, **k: geladen.append("asr"),
        load_align_model=lambda **k: (geladen.append(f"align:{k['language_code']}"), ("m", {}))[1],
    )
    monkeypatch.setitem(sys.modules, "whisperx", whisperx)
    monkeypatch.setitem(
        sys.modules, "swift_f0",
        _stub_module("swift_f0", SwiftF0=lambda: geladen.append("pitch")),
    )


def test_preload_laedt_alle_vier_modellarten_und_schreibt_ergebnis(tmp_path, monkeypatch, capsys):
    geladen: list[str] = []
    _installiere_modell_stubs(monkeypatch, geladen)
    out = tmp_path / "preload.json"

    rc = haupt.main(["--preload", "--language", "de", "--device", "cpu", "--out", str(out)])

    assert rc == 0
    assert "demucs:htdemucs" in geladen
    assert "asr" in geladen
    assert "align:de" in geladen
    assert "pitch" in geladen
    daten = json.loads(out.read_text(encoding="utf8"))
    assert daten["device"] == "cpu"
    assert daten["modelle"]["demucs"] == "htdemucs"
    stufen = [
        json.loads(z[len(PROGRESS_PREFIX):])["stage"]
        for z in capsys.readouterr().out.splitlines()
        if z.startswith(PROGRESS_PREFIX)
    ]
    for stufe in ("preload:demucs", "preload:asr", "preload:align", "preload:pitch"):
        assert stufe in stufen


def test_preload_fehlende_sprache_meldet_language_unsupported(tmp_path, monkeypatch, capsys):
    geladen: list[str] = []
    _installiere_modell_stubs(monkeypatch, geladen)

    def kein_align(**k):
        raise RuntimeError("kein Alignment-Modell")

    sys.modules["whisperx"].load_align_model = kein_align

    rc = haupt.main(["--preload", "--language", "xx", "--device", "cpu",
                     "--out", str(tmp_path / "p.json")])
    assert rc == 1
    assert "language_unsupported" in capsys.readouterr().out


def test_ohne_preload_bleiben_audio_und_lyrics_pflicht(tmp_path, capsys):
    rc = haupt.main(["--language", "de", "--out", str(tmp_path / "o.json")])
    assert rc == 1
    assert "audio_unreadable" in capsys.readouterr().out
```

Hinweis: Falls `progress.py` den Marker nur als Literal nutzt, dort `PROGRESS_PREFIX = "@@PROGRESS "` als benannte Konstante einführen und `emit_progress` sie verwenden lassen (`ERROR_PREFIX` existiert bereits benannt — dem Muster folgen).

- [ ] **Step 2: Fehlschlag belegen**

Run (aus `python-sidecar/` des Worktrees, Interpreter siehe Global Constraints): `<venv-python> -m pytest tests/test_preload.py -v`
Expected: FAIL (`--preload` unbekannt bzw. argparse verlangt `--audio`).

- [ ] **Step 3: `preload.py` implementieren**

```python
"""Modelle einmal laden: der Probelauf der Umgebungs-Einrichtung.

Erst wenn jede Modellart tatsaechlich geladen wurde, darf die Einrichtung
"fertig" melden — ein blosses pip-install beweist nur, dass Pakete liegen,
nicht dass Torch, CUDA und die Modell-Downloads zusammen funktionieren.
Geladen wird ueber dieselben Bibliotheksaufrufe wie im echten Lauf, damit
der Probelauf genau das prueft, was der erste Song brauchen wird.
"""

import json
from pathlib import Path

from . import separate, transcribe
from .cache import atomic_write_bytes
from .errors import LanguageUnsupported
from .progress import emit_progress


def preload(sprache: str, device: str, out: Path) -> None:
    """Laedt alle vier Modellarten und schreibt das Ergebnis nach `out`."""
    emit_progress("preload:demucs", 0.0)
    from demucs.pretrained import get_model

    get_model(separate.MODELL)
    emit_progress("preload:demucs", 1.0)

    emit_progress("preload:asr", 0.0)
    import whisperx

    try:
        whisperx.load_model(
            transcribe.MODELL,
            device,
            compute_type="float16" if device == "cuda" else "int8",
            language=sprache,
        )
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise
        raise LanguageUnsupported(sprache, stufe="transcribe") from exc
    emit_progress("preload:asr", 1.0)

    emit_progress("preload:align", 0.0)
    try:
        whisperx.load_align_model(language_code=sprache, device=device)
    except MemoryError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise
        raise LanguageUnsupported(sprache) from exc
    emit_progress("preload:align", 1.0)

    emit_progress("preload:pitch", 0.0)
    from swift_f0 import SwiftF0

    SwiftF0()
    emit_progress("preload:pitch", 1.0)

    atomic_write_bytes(
        out,
        json.dumps(
            {
                "device": device,
                "modelle": {
                    "demucs": separate.MODELL,
                    "asr": transcribe.MODELL,
                    "align": sprache,
                    "pitch": "swift-f0",
                },
            },
            ensure_ascii=False,
        ).encode("utf8"),
    )
```

- [ ] **Step 4: `__main__.py` verdrahten**

1. Argumente: `--audio` und `--lyrics-file` verlieren `required=True` (Typ bleibt `Path`); neu `p.add_argument("--preload", action="store_true")`.
2. `device = _waehle_device(args.device, warnungen)` wandert VOR die Datei-Checks; direkt danach der Preload-Zweig, dahinter die Datei-Checks mit None-Schutz:

```python
    device = _waehle_device(args.device, warnungen)

    if args.preload:
        # Probelauf der Umgebungs-Einrichtung: Modelle laden, Ergebnis
        # schreiben, fertig. Die Ausnahme-Uebersetzung entspricht der
        # bestehenden Fehlerleitung des echten Laufs.
        try:
            preload_modul.preload(args.language, device, args.out)
        except LanguageUnsupported as exc:
            emit_error("language_unsupported", language=exc.language, stufe=exc.stufe)
            return 1
        except ModuleNotFoundError as exc:
            emit_error("env_missing", module=exc.name)
            return 1
        except Exception as exc:  # noqa: BLE001 - letzte Instanz
            art = type(exc).__name__
            if "OutOfMemory" in art or "out of memory" in str(exc).lower():
                emit_error("device_error", detail="GPU-Speicher voll. Mit --device cpu erneut versuchen.")
            else:
                emit_error("pipeline_failed", detail=f"{art}: {exc}")
            return 1
        return 0

    if args.audio is None or not args.audio.is_file():
        emit_error("audio_unreadable", path=str(args.audio))
        return 1
    if args.lyrics_file is None or not args.lyrics_file.is_file():
        emit_error("lyrics_unreadable", path=str(args.lyrics_file))
        return 1
```

Import oben: `from . import preload as preload_modul` (Kollision mit dem Flag-Namen vermeiden). Die alten Datei-Checks entfallen an ihrer bisherigen Stelle. Modul-Docstring um den Preload-Modus ergänzen. Achtung: `_waehle_device` importiert torch lazy — der Test stubbt torch, das funktioniert nur, wenn der Zweig weiterhin `import torch` IN der Funktion macht (nichts daran ändern).

- [ ] **Step 5: Gruen belegen**

Run: `<venv-python> -m pytest -q` — 135 passed/1 deselected (132 + 3 neue). Formpruefung: keine neuen Nicht-ASCII-Zeilen, LF.

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/preload.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/ultrastar_pipeline/progress.py python-sidecar/tests/test_preload.py
git commit -m "feat(sidecar): preload mode loads all models as environment probe"
```

---

### Task 2: environment.ts — Typen, Manifest, Status

**Files:**
- Create: `src/core/create/environment.ts`
- Test: `src/core/create/environment.test.ts` (neu)

**Interfaces:**
- Produces (von Tasks 3–7 konsumiert):
  - Typen: `EnvironmentState = "missing" | "broken" | "outdated" | "ready"`; `InstallStep = "uv" | "venv" | "gpu" | "torch" | "sidecar" | "preload"`; `InstallProgress = { schritt: InstallStep; prozent: number | null; detail?: string }`; `EnvironmentStatus = { state: EnvironmentState; pythonVersion?: string; torchVariante?: "cu128" | "cpu"; fehler?: { schritt: InstallStep; detail: string } }`; `EnvironmentManifest` (siehe Code).
  - Funktionen: `envPythonBin(envDir: string): string`; `manifestPath(envDir: string): string`; `sidecarVersionFromPyproject(text: string): string | null`; `readManifest(envDir): Promise<EnvironmentManifest | null>`; `writeManifest(envDir, manifest): Promise<void>`; `environmentStatus(envDir: string, bundledSidecarVersion: string): Effect.Effect<EnvironmentStatus, never>`.

- [ ] **Step 1: Failing Tests schreiben** — `src/core/create/environment.test.ts`:

```typescript
// src/core/create/environment.test.ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  envPythonBin,
  environmentStatus,
  sidecarVersionFromPyproject,
  writeManifest,
} from "./environment.ts";

const tempEnv = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "env-test-"));
  return join(dir, "python-env");
};

/** Creates the venv python marker so status checks get past "missing". */
const fakePython = async (envDir: string): Promise<void> => {
  await mkdir(join(envDir, "Scripts"), { recursive: true });
  await writeFile(envPythonBin(envDir), "", "utf8");
};

const baseManifest = {
  schemaVersion: 1 as const,
  sidecarVersion: "0.1.0",
  pythonVersion: "3.12.8",
  torchVariante: "cu128" as const,
  preload: { ok: true, device: "cuda", datum: "2026-07-30" },
};

describe("sidecarVersionFromPyproject", () => {
  it("extracts the version line", () => {
    expect(
      sidecarVersionFromPyproject('[project]\nname = "x"\nversion = "0.1.0"\n'),
    ).toBe("0.1.0");
    expect(sidecarVersionFromPyproject("kein feld")).toBeNull();
  });
});

describe("environmentStatus", () => {
  it("reports missing without a manifest or python", async () => {
    const envDir = await tempEnv();
    const s = await Effect.runPromise(environmentStatus(envDir, "0.1.0"));
    expect(s.state).toBe("missing");
  });

  it("reports missing when the manifest exists but python is gone", async () => {
    const envDir = await tempEnv();
    await mkdir(envDir, { recursive: true });
    await writeManifest(envDir, baseManifest);
    const s = await Effect.runPromise(environmentStatus(envDir, "0.1.0"));
    expect(s.state).toBe("missing");
  });

  it("reports ready when manifest and python match", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await writeManifest(envDir, baseManifest);
    const s = await Effect.runPromise(environmentStatus(envDir, "0.1.0"));
    expect(s.state).toBe("ready");
    expect(s.torchVariante).toBe("cu128");
    expect(s.pythonVersion).toBe("3.12.8");
  });

  it("reports outdated when the bundled sidecar is newer", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await writeManifest(envDir, baseManifest);
    const s = await Effect.runPromise(environmentStatus(envDir, "0.2.0"));
    expect(s.state).toBe("outdated");
  });

  it("reports broken with step and detail after a failed install", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await writeManifest(envDir, {
      ...baseManifest,
      preload: { ok: false, device: "cpu", datum: "2026-07-30" },
      fehler: { schritt: "torch", detail: "No matching distribution" },
    });
    const s = await Effect.runPromise(environmentStatus(envDir, "0.1.0"));
    expect(s.state).toBe("broken");
    expect(s.fehler?.schritt).toBe("torch");
  });

  it("treats an unreadable manifest as missing instead of throwing", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "env.json"), "kein json", "utf8");
    const s = await Effect.runPromise(environmentStatus(envDir, "0.1.0"));
    expect(s.state).toBe("missing");
  });
});
```

- [ ] **Step 2: Fehlschlag belegen**

Run: `bun test src/core/create/environment.test.ts` — FAIL (Modul existiert nicht).

- [ ] **Step 3: Implementierung** — `src/core/create/environment.ts` (Kopf der Datei; Task 3 ergänzt die Installation):

```typescript
// src/core/create/environment.ts
// Managed Python environment for the sidecar (subproject 2). Pure logic:
// status is derived from a manifest file, installation runs through
// injectable runners so tests never touch uv, the network, or a GPU.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";

export type EnvironmentState = "missing" | "broken" | "outdated" | "ready";
export type InstallStep = "uv" | "venv" | "gpu" | "torch" | "sidecar" | "preload";

export type InstallProgress = {
  schritt: InstallStep;
  /** 0..1 while a download/run reports progress, null for spinner-only steps. */
  prozent: number | null;
  detail?: string;
};

export type EnvironmentStatus = {
  state: EnvironmentState;
  pythonVersion?: string;
  torchVariante?: "cu128" | "cpu";
  /** Present when state is "broken": which step failed, with the stderr tail. */
  fehler?: { schritt: InstallStep; detail: string };
};

export type EnvironmentManifest = {
  schemaVersion: 1;
  sidecarVersion: string;
  pythonVersion: string;
  torchVariante: "cu128" | "cpu";
  preload: { ok: boolean; device: string; datum: string };
  fehler?: { schritt: InstallStep; detail: string };
};

export const envPythonBin = (envDir: string): string =>
  join(envDir, "Scripts", "python.exe");

export const manifestPath = (envDir: string): string => join(envDir, "env.json");

/** The bundled sidecar's version is the freshness reference for "outdated". */
export const sidecarVersionFromPyproject = (text: string): string | null =>
  /^version\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;

export const readManifest = async (
  envDir: string,
): Promise<EnvironmentManifest | null> => {
  try {
    const raw = JSON.parse(await readFile(manifestPath(envDir), "utf8"));
    if (raw?.schemaVersion !== 1) return null;
    return raw as EnvironmentManifest;
  } catch {
    return null;
  }
};

export const writeManifest = async (
  envDir: string,
  manifest: EnvironmentManifest,
): Promise<void> => {
  await mkdir(envDir, { recursive: true });
  await writeFile(manifestPath(envDir), JSON.stringify(manifest, null, 2), "utf8");
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Status is read from the manifest only — no pip call on app start. A broken
 * or unreadable manifest degrades to "missing" so the UI simply offers the
 * install button instead of crashing on corrupted state.
 */
export const environmentStatus = (
  envDir: string,
  bundledSidecarVersion: string,
): Effect.Effect<EnvironmentStatus, never> =>
  Effect.promise(async (): Promise<EnvironmentStatus> => {
    const manifest = await readManifest(envDir);
    const pythonPresent = await fileExists(envPythonBin(envDir));
    if (!manifest || !pythonPresent) return { state: "missing" };
    if (manifest.fehler || !manifest.preload.ok) {
      return {
        state: "broken",
        pythonVersion: manifest.pythonVersion,
        torchVariante: manifest.torchVariante,
        fehler: manifest.fehler ?? {
          schritt: "preload",
          detail: "Probelauf nicht abgeschlossen.",
        },
      };
    }
    if (manifest.sidecarVersion !== bundledSidecarVersion) {
      return {
        state: "outdated",
        pythonVersion: manifest.pythonVersion,
        torchVariante: manifest.torchVariante,
      };
    }
    return {
      state: "ready",
      pythonVersion: manifest.pythonVersion,
      torchVariante: manifest.torchVariante,
    };
  });
```

(`rm` wird erst in Task 3 benutzt — Import trotzdem jetzt schon aufnehmen oder in Task 3 ergänzen; Biome meckert ungenutzte Importe an: dann erst in Task 3.)

- [ ] **Step 4: Gruen belegen**

Run: `bun test src/core/create/environment.test.ts` — alle PASS. `bun test src` und `bunx tsc --noEmit` sauber.

- [ ] **Step 5: Commit**

```bash
git add src/core/create/environment.ts src/core/create/environment.test.ts
git commit -m "feat(create): environment manifest and status machine"
```

---

### Task 3: environment.ts — installEnvironment mit injizierten Runnern

**Files:**
- Modify: `src/core/create/environment.ts`
- Modify: `src/core/create/environment.test.ts` (Ergänzungen)

**Interfaces:**
- Consumes: alles aus Task 2; Sidecar-CLI `--preload` (Task 1).
- Produces:
  - `type CommandResult = { code: number; stdout: string; stderr: string }`
  - `type InstallRunner = { fetchFn: typeof fetch; runCommand: (cmd: string, args: string[], onLine?: (line: string) => void) => Promise<CommandResult>; freeDiskBytes: (dir: string) => Promise<number | null>; platform: NodeJS.Platform }`
  - `defaultRunner(signal?: AbortSignal): InstallRunner` (echtes spawn/fetch/statfs; von Desktop UND Dev-Skript genutzt; das Signal geht an `spawn(cmd, args, { signal, ... })`)
  - `type InstallOptions = { envDir: string; binDir: string; sidecarDir: string; bundledSidecarVersion: string; force?: boolean; language?: string; onProgress?: (p: InstallProgress) => void; runner?: Partial<InstallRunner>; signal?: AbortSignal }`
  - Abbruch: `defaultRunner(signal?: AbortSignal)` reicht das Signal an `spawn(cmd, args, { signal })` durch (Node killt dann den Prozess); `installEnvironment` prueft zusaetzlich VOR jedem Schritt `opts.signal?.aborted` und wirft dann `{ schritt, detail: "Abgebrochen." }` — der catch-Pfad schreibt wie bei jedem Fehler das broken-Manifest. Der Fake-Runner in den Tests ignoriert das Signal; ein eigener Test dafuer: `signal` schon vor dem Aufruf abgebrochen → Left mit detail "Abgebrochen.", Manifest broken.
  - `type EnvironmentError = { schritt: InstallStep; detail: string }`
  - `installEnvironment(opts: InstallOptions): Effect.Effect<EnvironmentStatus, EnvironmentError>`
  - `uvBin(binDir: string): string` (=> `join(binDir, "uv.exe")`)

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `environment.test.ts`. Der Fake-Runner protokolliert Aufrufe und simuliert Erfolge; der `-m ultrastar_pipeline`-Aufruf legt das preload.json an, wie es der echte Sidecar taete:

```typescript
type Call = { cmd: string; args: string[] };

const fakeRunner = (opts?: {
  nvidia?: boolean;
  failStep?: string; // substring matched against the command line
}) => {
  const calls: Call[] = [];
  const runCommand = async (
    cmd: string,
    args: string[],
    onLine?: (line: string) => void,
  ) => {
    calls.push({ cmd, args });
    const line = `${cmd} ${args.join(" ")}`;
    if (opts?.failStep && line.includes(opts.failStep)) {
      return { code: 1, stdout: "", stderr: "simulierter Fehler\nletzte Zeile" };
    }
    if (cmd === "nvidia-smi") {
      return { code: opts?.nvidia === false ? 1 : 0, stdout: "GPU", stderr: "" };
    }
    if (args.includes("--preload")) {
      const out = args[args.indexOf("--out") + 1] as string;
      onLine?.('@@PROGRESS {"stage":"preload:asr","percent":1}');
      await writeFile(out, JSON.stringify({ device: "cuda", modelle: {} }), "utf8");
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return {
    calls,
    runner: {
      runCommand,
      fetchFn: (() => {
        throw new Error("Netz darf im Test nicht angefasst werden");
      }) as unknown as typeof fetch,
      freeDiskBytes: async () => 50_000_000_000,
      platform: "win32" as NodeJS.Platform,
    },
  };
};

const installOpts = (envDir: string, runner: Partial<import("./environment.ts").InstallRunner>) => ({
  envDir,
  binDir: join(envDir, "..", "bin"),
  sidecarDir: "C:/repo/python-sidecar",
  bundledSidecarVersion: "0.1.0",
  onProgress: () => {},
  runner,
});

describe("installEnvironment", () => {
  it("runs the six steps in order and writes a ready manifest", async () => {
    const envDir = await tempEnv();
    const { calls, runner } = fakeRunner();
    // uv resolves via PATH probe (uv --version succeeds in the fake).
    const status = await Effect.runPromise(
      installEnvironment(installOpts(envDir, runner)),
    );
    expect(status.state).toBe("ready");
    expect(status.torchVariante).toBe("cu128");
    const line = (c: Call) => `${c.cmd} ${c.args.join(" ")}`;
    const venvIdx = calls.findIndex((c) => line(c).includes("venv --python 3.12"));
    const torchIdx = calls.findIndex((c) => line(c).includes("torch==2.8.0+cu128"));
    const sidecarIdx = calls.findIndex((c) => line(c).includes("[models]"));
    const preloadIdx = calls.findIndex((c) => c.args.includes("--preload"));
    expect(venvIdx).toBeGreaterThanOrEqual(0);
    expect(torchIdx).toBeGreaterThan(venvIdx);
    expect(sidecarIdx).toBeGreaterThan(torchIdx);
    expect(preloadIdx).toBeGreaterThan(sidecarIdx);
    expect(
      calls.some((c) => line(c).includes("--index-url https://download.pytorch.org/whl/cu128")),
    ).toBe(true);
  });

  it("falls back to the cpu index without nvidia-smi", async () => {
    const envDir = await tempEnv();
    const { calls, runner } = fakeRunner({ nvidia: false });
    const status = await Effect.runPromise(
      installEnvironment(installOpts(envDir, runner)),
    );
    expect(status.torchVariante).toBe("cpu");
    expect(
      calls.some((c) => `${c.args.join(" ")}`.includes("torch==2.8.0+cpu")),
    ).toBe(true);
  });

  it("writes a broken manifest with step and stderr tail on failure", async () => {
    const envDir = await tempEnv();
    const { runner } = fakeRunner({ failStep: "torch==" });
    const ergebnis = await Effect.runPromise(
      Effect.either(installEnvironment(installOpts(envDir, runner))),
    );
    expect(ergebnis._tag).toBe("Left");
    if (ergebnis._tag === "Left") {
      expect(ergebnis.left.schritt).toBe("torch");
      expect(ergebnis.left.detail).toContain("letzte Zeile");
    }
    const status = await Effect.runPromise(environmentStatus(envDir, "0.1.0"));
    expect(status.state === "broken" || status.state === "missing").toBe(true);
  });

  it("force removes the venv before reinstalling", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await writeFile(join(envDir, "marker.txt"), "alt", "utf8");
    const { runner } = fakeRunner();
    await Effect.runPromise(
      installEnvironment({ ...installOpts(envDir, runner), force: true }),
    );
    expect(await Bun.file(join(envDir, "marker.txt")).exists()).toBe(false);
  });

  it("refuses non-windows platforms with a clear message", async () => {
    const envDir = await tempEnv();
    const { runner } = fakeRunner();
    const ergebnis = await Effect.runPromise(
      Effect.either(
        installEnvironment(installOpts(envDir, { ...runner, platform: "darwin" })),
      ),
    );
    expect(ergebnis._tag).toBe("Left");
    if (ergebnis._tag === "Left") expect(ergebnis.left.schritt).toBe("uv");
  });
});
```

(Imports oben ergänzen: `installEnvironment` und den Typ `InstallRunner`.)

- [ ] **Step 2: Fehlschlag belegen** — `bun test src/core/create/environment.test.ts`: neue Tests FAIL.

- [ ] **Step 3: Implementierung** in `environment.ts`:

```typescript
export type CommandResult = { code: number; stdout: string; stderr: string };

export type InstallRunner = {
  fetchFn: typeof fetch;
  runCommand: (
    cmd: string,
    args: string[],
    onLine?: (line: string) => void,
  ) => Promise<CommandResult>;
  /** null = unknown (statfs unsupported); the check then simply passes. */
  freeDiskBytes: (dir: string) => Promise<number | null>;
  platform: NodeJS.Platform;
};

export type EnvironmentError = { schritt: InstallStep; detail: string };

export type InstallOptions = {
  envDir: string;
  binDir: string;
  sidecarDir: string;
  bundledSidecarVersion: string;
  force?: boolean;
  language?: string;
  onProgress?: (p: InstallProgress) => void;
  runner?: Partial<InstallRunner>;
};

export const uvBin = (binDir: string): string => join(binDir, "uv.exe");

const UV_ZIP_URL =
  "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip";
const TORCH_INDEX = {
  cu128: "https://download.pytorch.org/whl/cu128",
  cpu: "https://download.pytorch.org/whl/cpu",
} as const;
// Pinned on purpose: an unpinned torch silently degrades to a CPU build
// (measured both here and in the USKMaker reference project).
const TORCH_PINS = {
  cu128: ["torch==2.8.0+cu128", "torchaudio==2.8.0+cu128"],
  cpu: ["torch==2.8.0+cpu", "torchaudio==2.8.0+cpu"],
} as const;
const MIN_FREE_BYTES = 12_000_000_000;

let installRunning = false;

/** Real processes/network for desktop and the dev script; tests inject fakes. */
export const defaultRunner = (signal?: AbortSignal): InstallRunner => ({
  fetchFn: fetch,
  runCommand: (cmd, args, onLine) =>
    new Promise((resolve) => {
      // Line-streamed spawn so @@PROGRESS from the preload probe reaches the
      // UI; the abort signal lets the user cancel a running step (Node then
      // kills the child process tree for us).
      const child = require("node:child_process").spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
      });
      let stdout = "";
      let stderr = "";
      let rest = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (s: string) => {
        stdout += s;
        rest += s;
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) onLine?.(line);
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (s: string) => {
        stderr += s;
      });
      child.on("error", (err: Error) =>
        resolve({ code: 127, stdout, stderr: `${stderr}\n${err.message}` }),
      );
      child.on("close", (code: number | null) =>
        resolve({ code: code ?? 1, stdout, stderr }),
      );
    }),
  freeDiskBytes: async (dir) => {
    try {
      const { statfs } = await import("node:fs/promises");
      const s = await statfs(dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  },
  platform: process.platform,
});

const stderrTail = (r: CommandResult): string =>
  (r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n").slice(-500);

export const installEnvironment = (
  opts: InstallOptions,
): Effect.Effect<EnvironmentStatus, EnvironmentError> =>
  Effect.tryPromise({
    try: async (): Promise<EnvironmentStatus> => {
      if (installRunning) {
        throw { schritt: "uv", detail: "Eine Einrichtung laeuft bereits." };
      }
      installRunning = true;
      const runner: InstallRunner = { ...defaultRunner(), ...opts.runner };
      const melde = (p: InstallProgress): void => opts.onProgress?.(p);
      const sprache = opts.language ?? "de";
      let torchVariante: "cu128" | "cpu" = "cpu";
      let schritt: InstallStep = "uv";
      try {
        if (runner.platform !== "win32") {
          throw new Error(
            "Automatische Einrichtung gibt es nur unter Windows. Bitte die Umgebung manuell aufsetzen (siehe python-sidecar/pyproject.toml).",
          );
        }
        const frei = await runner.freeDiskBytes(opts.envDir);
        if (frei !== null && frei < MIN_FREE_BYTES) {
          melde({ schritt: "uv", prozent: null, detail: "Wenig Plattenplatz (unter 12 GB frei) - Installation braucht ~10 GB." });
        }
        if (opts.force) {
          await rm(opts.envDir, { recursive: true, force: true });
        }

        // Step 1: uv. Reuse managed or PATH uv; download only as last resort.
        melde({ schritt: "uv", prozent: null });
        const uv = await ensureUv(opts.binDir, runner, melde);

        // Step 2: venv with a self-provisioned Python 3.12 (WhisperX cannot
        // run on current Python versions, so we never rely on the system one).
        schritt = "venv";
        melde({ schritt, prozent: null });
        const python = envPythonBin(opts.envDir);
        if (opts.force || !(await fileExists(python))) {
          await mussGelingen(
            runner.runCommand(uv, ["venv", "--python", "3.12", opts.envDir]),
            schritt,
          );
        }

        // Step 3: GPU detection - visible choice, never a silent guess.
        schritt = "gpu";
        melde({ schritt, prozent: null });
        const nvidia = await runner.runCommand("nvidia-smi", []);
        torchVariante = nvidia.code === 0 ? "cu128" : "cpu";
        melde({
          schritt,
          prozent: 1,
          detail: torchVariante === "cu128" ? "NVIDIA-GPU erkannt" : "Keine NVIDIA-GPU - CPU-Variante (deutlich langsamer)",
        });

        // Step 4: pinned torch from the matching index.
        schritt = "torch";
        melde({ schritt, prozent: null });
        await mussGelingen(
          runner.runCommand(uv, [
            "pip", "install", "--python", python,
            ...TORCH_PINS[torchVariante],
            "--index-url", TORCH_INDEX[torchVariante],
          ]),
          schritt,
        );

        // Step 5: the bundled sidecar package with its model extras.
        schritt = "sidecar";
        melde({ schritt, prozent: null });
        await mussGelingen(
          runner.runCommand(uv, [
            "pip", "install", "--python", python, `${opts.sidecarDir}[models]`,
          ]),
          schritt,
        );

        // Step 6: preload probe - "ready" is only claimed after every model
        // family actually loaded once on this machine.
        schritt = "preload";
        melde({ schritt, prozent: null });
        const preloadOut = join(opts.envDir, "preload.json");
        await mussGelingen(
          runner.runCommand(
            python,
            ["-m", "ultrastar_pipeline", "--preload", "--language", sprache, "--out", preloadOut],
            (line) => {
              if (!line.startsWith("@@PROGRESS ")) return;
              try {
                const p = JSON.parse(line.slice("@@PROGRESS ".length));
                melde({ schritt: "preload", prozent: Number(p.percent), detail: String(p.stage) });
              } catch {
                // a garbled progress line is not a reason to abort
              }
            },
          ),
          schritt,
        );
        const preload = JSON.parse(await readFile(preloadOut, "utf8"));

        await writeManifest(opts.envDir, {
          schemaVersion: 1,
          sidecarVersion: opts.bundledSidecarVersion,
          pythonVersion: "3.12",
          torchVariante,
          preload: { ok: true, device: String(preload.device), datum: new Date().toISOString().slice(0, 10) },
        });
        return await Effect.runPromise(
          environmentStatus(opts.envDir, opts.bundledSidecarVersion),
        );
      } catch (fehler) {
        const detail =
          typeof fehler === "object" && fehler !== null && "detail" in fehler
            ? String((fehler as { detail: unknown }).detail)
            : fehler instanceof Error
              ? fehler.message
              : String(fehler);
        const kaputt: EnvironmentError = {
          schritt:
            typeof fehler === "object" && fehler !== null && "schritt" in fehler
              ? ((fehler as { schritt: InstallStep }).schritt)
              : schritt,
          detail,
        };
        // Record the failure so the UI can show "broken" + retry after restart.
        await writeManifest(opts.envDir, {
          schemaVersion: 1,
          sidecarVersion: opts.bundledSidecarVersion,
          pythonVersion: "3.12",
          torchVariante,
          preload: { ok: false, device: "unbekannt", datum: new Date().toISOString().slice(0, 10) },
          fehler: kaputt,
        }).catch(() => {});
        throw kaputt;
      } finally {
        installRunning = false;
      }
    },
    catch: (fehler): EnvironmentError =>
      typeof fehler === "object" && fehler !== null && "schritt" in fehler
        ? (fehler as EnvironmentError)
        : { schritt: "uv", detail: fehler instanceof Error ? fehler.message : String(fehler) },
  });

const mussGelingen = async (
  lauf: Promise<CommandResult>,
  schritt: InstallStep,
): Promise<CommandResult> => {
  const ergebnis = await lauf;
  if (ergebnis.code !== 0) {
    throw { schritt, detail: stderrTail(ergebnis) };
  }
  return ergebnis;
};

/**
 * Resolve uv: managed copy first, then PATH, then download the official zip.
 * The download path is exercised by the real end-to-end run (Task 8), not by
 * unit tests - building a valid zip in a test would test extract-zip, not us.
 */
const ensureUv = async (
  binDir: string,
  runner: InstallRunner,
  melde: (p: InstallProgress) => void,
): Promise<string> => {
  const managed = uvBin(binDir);
  if (await fileExists(managed)) return managed;
  if ((await runner.runCommand("uv", ["--version"])).code === 0) return "uv";

  const antwort = await runner.fetchFn(UV_ZIP_URL, { redirect: "follow" });
  if (!antwort.ok || !antwort.body) {
    throw { schritt: "uv", detail: `uv-Download fehlgeschlagen: ${antwort.status}` };
  }
  await mkdir(binDir, { recursive: true });
  const zipPath = join(binDir, "uv-download.zip");
  const gesamt = Number(antwort.headers.get("content-length") ?? 0);
  let empfangen = 0;
  const chunks: Uint8Array[] = [];
  const reader = antwort.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      empfangen += value.byteLength;
      if (gesamt > 0) melde({ schritt: "uv", prozent: Math.min(1, empfangen / gesamt) });
    }
  }
  await writeFile(zipPath, Buffer.concat(chunks));
  const extractZip = (await import("extract-zip")).default;
  await extractZip(zipPath, { dir: binDir });
  await rm(zipPath, { force: true });
  if (!(await fileExists(managed))) {
    throw { schritt: "uv", detail: "uv.exe nach dem Entpacken nicht gefunden." };
  }
  return managed;
};
```

Hinweis für den Implementer: `require` in `defaultRunner` durch einen normalen Top-Level-Import `import { spawn } from "node:child_process"` ersetzen (der Codeblock zeigt die Logik; Top-Level-Import ist die saubere Form und bricht keine Tests, weil `defaultRunner` in Tests nie aufgerufen wird). `rm`/`writeFile` sind ab dieser Task importiert.

- [ ] **Step 4: Gruen belegen** — `bun test src` (alle, inkl. Task-2-Tests) und `bunx tsc --noEmit` sauber.

- [ ] **Step 5: Commit**

```bash
git add src/core/create/environment.ts src/core/create/environment.test.ts
git commit -m "feat(create): six-step environment installer with injectable runners"
```

---

### Task 4: Interpreter-Aufloesung in runPipeline

**Files:**
- Modify: `src/core/create/environment.ts` (eine Funktion)
- Modify: `src/core/create/pipeline.ts`
- Modify: `src/core/create/environment.test.ts`, `src/core/create/pipeline.test.ts`

**Interfaces:**
- Produces: `resolvePythonBin(explicit: string | undefined, envDir: string | undefined): string` in environment.ts (sync; Reihenfolge: explizit > verwaltete venv, wenn deren python.exe existiert > `"python"` aus PATH). `PipelineInput` erhaelt `managedEnvDir?: string`; `runPipeline` nutzt `resolvePythonBin(input.pythonBin, input.managedEnvDir)`. Die `EnvMissing`-Meldung lautet neu exakt: `"Python-Interpreter nicht gefunden. KI-Umgebung in den Einstellungen einrichten."`

- [ ] **Step 1: Failing Tests.** In `environment.test.ts`:

```typescript
import { existsSync } from "node:fs"; // nur falls fuer Setup gebraucht

describe("resolvePythonBin", () => {
  it("prefers the explicit interpreter", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    expect(resolvePythonBin("C:/x/python.exe", envDir)).toBe("C:/x/python.exe");
  });

  it("falls back to the managed venv when it exists", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    expect(resolvePythonBin(undefined, envDir)).toBe(envPythonBin(envDir));
  });

  it("falls back to PATH python otherwise", async () => {
    const envDir = await tempEnv(); // ohne fakePython
    expect(resolvePythonBin(undefined, envDir)).toBe("python");
    expect(resolvePythonBin(undefined, undefined)).toBe("python");
  });
});
```

In `pipeline.test.ts` einen Test ergaenzen (Helfer `fakeSidecar`/`basis`/`gueltigesJson` existieren): ein `managedEnvDir` mit angelegter `Scripts/python.exe`, die KEIN ausfuehrbares Python ist, fuehrt zum Spawn-Fehler → `EnvMissing` mit der neuen Meldung. Zusaetzlich: der bestehende EnvMissing-Test (falls er den alten Text `"Teilprojekt 2"` prueft) bekommt den neuen Text.

```typescript
  it("nutzt die verwaltete Umgebung und meldet EnvMissing mit Settings-Hinweis", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipeline-env-"));
    const envDir = join(dir, "python-env");
    await mkdir(join(envDir, "Scripts"), { recursive: true });
    await writeFile(join(envDir, "Scripts", "python.exe"), "", "utf8");
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), managedEnvDir: envDir })),
    );
    expect(e._tag).toBe("Left");
    if (e._tag === "Left") {
      expect(e.left.kind).toBe("EnvMissing");
      expect(e.left.detail).toContain("Einstellungen");
    }
  });
```

(Imports in pipeline.test.ts ergaenzen: `mkdir`, `mkdtemp`, `writeFile`, `tmpdir`, sofern nicht vorhanden. Hinweis: eine leere .exe zu spawnen liefert unter Windows einen Spawn-/UNKNOWN-Fehler — der bestehende catch-Zweig mappt jede ENOENT-Meldung auf EnvMissing; erweitere das Mapping auf `ENOENT` ODER `UNKNOWN`/`EACCES` beim Spawn, damit der Test deterministisch EnvMissing sieht.)

- [ ] **Step 2: Fehlschlag belegen** — beide Testdateien laufen lassen, neue Tests FAIL.

- [ ] **Step 3: Implementierung.**

environment.ts:

```typescript
import { existsSync } from "node:fs";

/**
 * Interpreter resolution for runPipeline: explicit wins, then the managed
 * environment (if its python.exe exists), then plain "python" from PATH.
 * Sync on purpose - it runs once per pipeline start, not in a hot path.
 */
export const resolvePythonBin = (
  explicit: string | undefined,
  envDir: string | undefined,
): string => {
  if (explicit) return explicit;
  if (envDir) {
    const managed = envPythonBin(envDir);
    if (existsSync(managed)) return managed;
  }
  return "python";
};
```

pipeline.ts:
1. `PipelineInput` ergaenzen: `/** Managed environment directory; resolvePythonBin falls back to it. */ managedEnvDir?: string;`
2. `const bin = input.pythonBin ?? "python";` wird zu `const bin = resolvePythonBin(input.pythonBin, input.managedEnvDir);` (Import aus `./environment.ts`).
3. Im catch-Zweig die EnvMissing-Erkennung erweitern und den Text ersetzen:

```typescript
      if (meldung.includes("ENOENT") || meldung.includes("UNKNOWN") || meldung.includes("EACCES")) {
        return {
          kind: "EnvMissing",
          detail: "Python-Interpreter nicht gefunden. KI-Umgebung in den Einstellungen einrichten.",
        };
      }
```

- [ ] **Step 4: Gruen belegen** — `bun test src`, `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/core/create/environment.ts src/core/create/environment.test.ts src/core/create/pipeline.ts src/core/create/pipeline.test.ts
git commit -m "feat(create): resolve python from managed environment"
```

---

### Task 5: IPC-Vertrag, Desktop-Main-Anbindung, Paketierung

**Files:**
- Modify: `src/desktop/shared/ipcContract.ts`
- Create: `src/desktop/main/environment.ts`
- Modify: `src/desktop/preload/index.ts`
- Modify: `src/desktop/main/ipc.ts` (zwei Handler, exakt nach dem Muster der `binaries:*`-Handler dort)
- Modify: `electron-builder.yml`
- Test: `src/desktop/shared/ipcContract.test.ts`, `src/desktop/main/ipc.test.ts` (Ergaenzungen)

**Interfaces:**
- Consumes: `environmentStatus`, `installEnvironment`, `defaultRunner`, `sidecarVersionFromPyproject`, Typen aus Task 2/3.
- Produces:
  - ipcContract: `INVOKE_CHANNELS` + `"environment:status"`, `"environment:install"`, `"environment:cancel"`; `EVENT_CHANNELS` + `"event:environmentProgress"`, `"event:environmentStatus"`; Re-Export der Typen `EnvironmentState`, `EnvironmentStatus`, `InstallProgress` aus `../../core/create/environment.ts` (type-only); `EventPayloads` + `"event:environmentProgress": InstallProgress | null` und `"event:environmentStatus": EnvironmentStatus`; `UltrastarApi` + `environmentStatus: () => Promise<EnvironmentStatus>` und `environmentInstall: (force?: boolean) => Promise<EnvironmentStatus>`.
  - desktop/main/environment.ts: `environmentStatusForApp(): Promise<EnvironmentStatus>` und `installEnvironmentForApp(force: boolean): Promise<EnvironmentStatus>` (plain async, ruft `Effect.runPromise`; broadcastet `event:environmentProgress` je Fortschritt, `null` am Ende, danach `event:environmentStatus`).

- [ ] **Step 1: Failing Tests.** `ipcContract.test.ts`: die bestehenden Zaehl-/Enthaltensein-Assertions um die drei neuen Invoke- (`environment:status`, `environment:install`, `environment:cancel`) und zwei neuen Event-Kanaele erweitern (Datei lesen, Muster uebernehmen — sie prueft Kanallisten). `ipc.test.ts`: im bestehenden Test, der die Handler-Vollstaendigkeit gegen `INVOKE_CHANNELS` prueft, schlagen die neuen Kanaele automatisch als fehlend auf — genau dieser rote Zustand ist der failing Test. Run: `bun test src/desktop` → FAIL.

- [ ] **Step 2: ipcContract.ts ergaenzen** (an den markierten Stellen):

```typescript
import type {
  EnvironmentStatus,
  EnvironmentState,
  InstallProgress,
} from "../../core/create/environment.ts";

export type { EnvironmentStatus, EnvironmentState, InstallProgress };
```

`INVOKE_CHANNELS`: `"environment:status", "environment:install",` (hinter den `binaries:*`-Eintraegen). `EVENT_CHANNELS`: `"event:environmentProgress", "event:environmentStatus",` (hinter den `binaries`-Events). `EventPayloads` ergaenzen:

```typescript
  "event:environmentProgress": InstallProgress | null;
  "event:environmentStatus": EnvironmentStatus;
```

`UltrastarApi` ergaenzen:

```typescript
  environmentStatus: () => Promise<EnvironmentStatus>;
  /** force=true wipes the venv and reinstalls from scratch. */
  environmentInstall: (force?: boolean) => Promise<EnvironmentStatus>;
  /** Aborts a running install; the environment then reports "broken". */
  environmentCancel: () => Promise<void>;
```

- [ ] **Step 3: desktop/main/environment.ts**

```typescript
// src/desktop/main/environment.ts
// Desktop wiring for the managed sidecar environment - same shape as
// binaries.ts: status query, install with progress broadcast, install lock
// (the lock itself lives in core installEnvironment).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { app } from "electron";
import {
  defaultRunner,
  environmentStatus,
  installEnvironment,
  sidecarVersionFromPyproject,
  type EnvironmentStatus as Status,
} from "../../core/create/environment.ts";
import { broadcast } from "./state.ts";

export const managedEnvDir = (): string =>
  join(app.getPath("userData"), "python-env");

/** Packaged builds carry the sidecar as an extraResource; dev uses the repo. */
export const sidecarDir = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "python-sidecar")
    : join(app.getAppPath(), "python-sidecar");

const bundledSidecarVersion = async (): Promise<string> => {
  try {
    const text = await readFile(join(sidecarDir(), "pyproject.toml"), "utf8");
    return sidecarVersionFromPyproject(text) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const environmentStatusForApp = async (): Promise<Status> =>
  Effect.runPromise(environmentStatus(managedEnvDir(), await bundledSidecarVersion()));

let laufenderAbbruch: AbortController | null = null;

export const installEnvironmentForApp = async (force: boolean): Promise<Status> => {
  laufenderAbbruch = new AbortController();
  try {
    const status = await Effect.runPromise(
      installEnvironment({
        envDir: managedEnvDir(),
        binDir: join(app.getPath("userData"), "bin"),
        sidecarDir: sidecarDir(),
        bundledSidecarVersion: await bundledSidecarVersion(),
        force,
        signal: laufenderAbbruch.signal,
        runner: defaultRunner(laufenderAbbruch.signal),
        onProgress: (p) => broadcast("event:environmentProgress", p),
      }),
    );
    return status;
  } finally {
    laufenderAbbruch = null;
    broadcast("event:environmentProgress", null);
    broadcast("event:environmentStatus", await environmentStatusForApp());
  }
};

export const cancelEnvironmentInstall = (): void => {
  laufenderAbbruch?.abort();
};
```

- [ ] **Step 4: ipc.ts + preload verdrahten.** In `ipc.ts` die zwei Handler exakt nach dem Muster der `binaries:*`-Handler registrieren:

```typescript
  "environment:status": () => environmentStatusForApp(),
  "environment:install": (_event, force?: boolean) =>
    installEnvironmentForApp(force === true),
  "environment:cancel": () => cancelEnvironmentInstall(),
```

(Import oben aus `./environment.ts`; die genaue Handler-Signatur an die Nachbarn in der Datei angleichen — sie ist dort einheitlich.) In `preload/index.ts`:

```typescript
  environmentStatus: () => ipcRenderer.invoke("environment:status"),
  environmentInstall: (force) => ipcRenderer.invoke("environment:install", force),
  environmentCancel: () => ipcRenderer.invoke("environment:cancel"),
```

- [ ] **Step 5: electron-builder.yml** — extraResources ergaenzen (vorhandene Struktur der Datei respektieren; falls es noch keinen `extraResources`-Block gibt, neu anlegen):

```yaml
extraResources:
  - from: python-sidecar
    to: python-sidecar
    filter:
      - "**/*"
      - "!.venv*/**"
      - "!.uv-bin/**"
      - "!tests/**"
      - "!**/__pycache__/**"
      - "!.pipeline-cache/**"
```

- [ ] **Step 6: Gruen belegen** — `bun test src` (ipcContract- und ipc-Tests wieder gruen), `bunx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add src/desktop/shared/ipcContract.ts src/desktop/main/environment.ts src/desktop/main/ipc.ts src/desktop/preload/index.ts electron-builder.yml src/desktop/shared/ipcContract.test.ts src/desktop/main/ipc.test.ts
git commit -m "feat(desktop): environment install wired through IPC"
```

---

### Task 6: SettingsView — Abschnitt „KI-Umgebung"

**Files:**
- Modify: `src/desktop/renderer/views/SettingsView.tsx`

**Interfaces:**
- Consumes: `window.ultrastar.environmentStatus()`, `window.ultrastar.environmentInstall(force)`, Events `event:environmentStatus`, `event:environmentProgress`; Typen aus ipcContract.

- [ ] **Step 1: Implementierung.** Es gibt keine Renderer-Komponententests im Projekt — Verifikation ueber `bunx tsc --noEmit` plus manuellen Smoke (`bun run desktop:dev`). Nach dem Muster des bestehenden „Tools"-Abschnitts, direkt dahinter einfuegen. State/Hooks oben in der Komponente:

```tsx
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [envInstalling, setEnvInstalling] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => {
    void window.ultrastar.environmentStatus().then(setEnv);
    return window.ultrastar.on("event:environmentStatus", setEnv);
  }, []);

  const envProgress = useIpcEvent("event:environmentProgress", null);

  const envInstall = async (force: boolean): Promise<void> => {
    setEnvInstalling(true);
    setEnvError(null);
    try {
      setEnv(await window.ultrastar.environmentInstall(force));
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvInstalling(false);
    }
  };
```

Typ-Import ergaenzen: `import type { AppConfig, BinariesStatus, EnvironmentStatus } from "../../shared/ipcContract.ts";` — und ein Label-Helfer neben `sourceLabel`:

```tsx
const envLabel = (s: EnvironmentStatus): string =>
  s.state === "ready"
    ? `bereit (${s.torchVariante === "cu128" ? "GPU" : "CPU"}, Python ${s.pythonVersion ?? "?"})`
    : s.state === "outdated"
      ? "veraltet - Aktualisierung empfohlen"
      : s.state === "broken"
        ? `defekt (Schritt ${s.fehler?.schritt ?? "?"})`
        : "nicht eingerichtet";

const SCHRITT_LABELS: Record<string, string> = {
  uv: "Werkzeug (uv)",
  venv: "Python 3.12",
  gpu: "GPU-Erkennung",
  torch: "Torch",
  sidecar: "Pipeline-Paket",
  preload: "KI-Modelle",
};
```

JSX-Abschnitt nach dem „Tools"-Block:

```tsx
      <h3 style={{ marginTop: 28 }}>KI-Umgebung (Song-Erstellung)</h3>
      {env === null ? (
        <p className="muted">Prüfe…</p>
      ) : (
        <>
          <p>
            Status: <strong>{envLabel(env)}</strong>
          </p>
          {env.state === "broken" && env.fehler && (
            <p className="muted">Letzter Fehler: {env.fehler.detail}</p>
          )}
          <div className="row">
            {env.state !== "ready" && (
              <button
                className="btn primary"
                type="button"
                disabled={envInstalling}
                onClick={() => void envInstall(false)}
              >
                {envInstalling ? (
                  "Richte ein…"
                ) : (
                  <>
                    <Download size={14} aria-hidden />
                    {env.state === "outdated"
                      ? "Jetzt aktualisieren"
                      : env.state === "broken"
                        ? "Erneut versuchen"
                        : "KI-Umgebung einrichten (~8 GB)"}
                  </>
                )}
              </button>
            )}
            {env.state === "ready" && (
              <button
                className="btn"
                type="button"
                disabled={envInstalling}
                onClick={() => void envInstall(true)}
              >
                <RefreshCw size={14} aria-hidden />
                Neu installieren
              </button>
            )}
            {envInstalling && (
              <button
                className="btn"
                type="button"
                onClick={() => void window.ultrastar.environmentCancel()}
              >
                Abbrechen
              </button>
            )}
          </div>
          {envProgress && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">
                {SCHRITT_LABELS[envProgress.schritt] ?? envProgress.schritt}
                {envProgress.detail ? ` – ${envProgress.detail}` : ""}
              </span>
              {envProgress.prozent !== null && (
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(envProgress.prozent * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {envError && <div className="error-banner">{envError}</div>}
        </>
      )}
```

- [ ] **Step 2: Gruen belegen** — `bun test src`, `bunx tsc --noEmit`; kurzer manueller Smoke mit `bun run desktop:dev` (Settings oeffnen, Status „nicht eingerichtet" sichtbar, Button vorhanden — NICHT klicken, der echte Lauf ist Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/desktop/renderer/views/SettingsView.tsx
git commit -m "feat(desktop): AI environment section in settings"
```

---

### Task 7: Dev-Skript `scripts/setupEnvironment.ts`

**Files:**
- Create: `scripts/setupEnvironment.ts` (camelCase gemaess CLAUDE.md; die bestehenden kebab-case-Skripte bleiben unangetastet)

**Interfaces:**
- Consumes: `installEnvironment`, `environmentStatus`, `defaultRunner`, `envPythonBin`, `sidecarVersionFromPyproject` aus `src/core/create/environment.ts`.
- Produces: `bun run scripts/setupEnvironment.ts [--dir <envDir>] [--force] [--language <sp>]` — richtet die Umgebung ein (Default-envDir `python-sidecar/.venv-managed`, uv nach `python-sidecar/.uv-bin`) und gibt am Ende den `PIPELINE_PYTHON`-Pfad aus.

- [ ] **Step 1: Implementierung**

```typescript
// scripts/setupEnvironment.ts
// Developer entry for the managed sidecar environment - replaces the manual
// venv how-to from the subproject-1 plan. Usage:
//   bun run scripts/setupEnvironment.ts [--dir <envDir>] [--force] [--language de]
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import {
  defaultRunner,
  environmentStatus,
  envPythonBin,
  installEnvironment,
  sidecarVersionFromPyproject,
} from "../src/core/create/environment.ts";

const argWert = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async (): Promise<void> => {
  const sidecar = resolve("python-sidecar");
  const envDir = resolve(argWert("--dir") ?? join(sidecar, ".venv-managed"));
  const version =
    sidecarVersionFromPyproject(await readFile(join(sidecar, "pyproject.toml"), "utf8")) ??
    "0.0.0";

  const ergebnis = await Effect.runPromise(
    Effect.either(
      installEnvironment({
        envDir,
        binDir: join(sidecar, ".uv-bin"),
        sidecarDir: sidecar,
        bundledSidecarVersion: version,
        force: process.argv.includes("--force"),
        language: argWert("--language") ?? "de",
        runner: defaultRunner(),
        onProgress: (p) =>
          process.stderr.write(
            `\r${p.schritt}${p.detail ? ` ${p.detail}` : ""}${
              p.prozent !== null ? ` ${Math.round(p.prozent * 100)}%` : ""
            }    `,
          ),
      }),
    ),
  );
  process.stderr.write("\n");

  if (ergebnis._tag === "Left") {
    console.error(`FEHLER in Schritt ${ergebnis.left.schritt}: ${ergebnis.left.detail}`);
    process.exit(1);
  }
  const status = await Effect.runPromise(environmentStatus(envDir, version));
  console.log(`Status: ${status.state} (${status.torchVariante ?? "?"})`);
  console.log(`PIPELINE_PYTHON=${envPythonBin(envDir)}`);
};

if (import.meta.main) {
  await main();
}
```

- [ ] **Step 2: Gruen belegen** — `bunx tsc --noEmit` (scripts/ wird miterfasst); `bun test src` unveraendert. Das Skript NICHT echt laufen lassen — das ist Task 8.

- [ ] **Step 3: `.gitignore` pruefen/ergaenzen:** `python-sidecar/.venv-managed/` und `python-sidecar/.uv-bin/` muessen ignoriert sein (Eintraege ergaenzen, falls das bestehende Muster `.venv*` sie nicht schon abdeckt — nachsehen).

- [ ] **Step 4: Commit**

```bash
git add scripts/setupEnvironment.ts .gitignore
git commit -m "feat(scripts): dev entry for managed environment setup"
```

---

### Task 8: Durchstich — echter Einrichtungslauf (Controller, GPU-Rechner)

Kein Subagent-Task: der Controller fuehrt den echten Lauf auf dem Entwicklungsrechner aus (Netz, GPU, ~8-10 GB Downloads beim ersten Mal).

- [ ] **Step 1: Lauf**

```bash
bun run scripts/setupEnvironment.ts 2> setup-log.txt
```

(Ausgabe in eine Scratchpad-Datei, nicht durch tail pipen.) Erwartet: alle sechs Schritte laufen durch, `Status: ready (cu128)`, `PIPELINE_PYTHON=...` wird ausgegeben; `python-sidecar/.venv-managed/env.json` hat `preload.ok: true, device: "cuda"`.

- [ ] **Step 2: Beleg, dass die Umgebung wirklich traegt**

Einen einzelnen Song des Referenzkorpus mit `PIPELINE_PYTHON=<ausgegebener Pfad>` durch `scripts/evaluate-pipeline.ts` laufen lassen (frisches `--work-dir`, damit nichts aus alten Caches kommt) — erwartet: identische Kennzahlen wie mit der handgebauten venv.

- [ ] **Step 3: Bericht an den Nutzer** — Dauer je Schritt, Plattenverbrauch, etwaige Warnungen; danach Abschluss des Teilprojekts ueber superpowers:finishing-a-development-branch.

---

## Ausfuehrungshinweise

- Reihenfolge strikt 1 → 8; jede Task laesst `bun test src`, `bunx tsc --noEmit` und pytest gruen zurueck.
- Tasks 3 und 5 sind die anspruchsvollsten (Prozess-Orchestrierung bzw. IPC-Verdrahtung) — Implementer auf einem Standard-Modell; 1, 2, 4, 6, 7 sind mit vollstaendigem Code spezifiziert und eignen sich fuer das guenstigste Modell.
- Task 8 erst nach Review-Abschluss von 1-7.


