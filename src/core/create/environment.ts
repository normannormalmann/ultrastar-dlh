// Managed Python environment for the sidecar (subproject 2). Pure logic:
// status is derived from a manifest file, installation runs through
// injectable runners so tests never touch uv, the network, or a GPU.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  /** Content hash of the sidecar sources this environment was built from. */
  sidecarFingerprint: string;
  pythonVersion: string;
  torchVariante: "cu128" | "cpu";
  preload: { ok: boolean; device: string; datum: string };
  fehler?: { schritt: InstallStep; detail: string };
};

export const envPythonBin = (envDir: string): string =>
  join(envDir, "Scripts", "python.exe");

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

export const manifestPath = (envDir: string): string => join(envDir, "env.json");

/**
 * Freshness reference for "outdated": a hash over the sidecar sources.
 *
 * The environment installs a *copy* of the sidecar (uv pip install), so new
 * sidecar code only reaches it through a reinstall. A version string would
 * only catch that if someone remembered to bump it - measured the hard way:
 * a worker mode added without a version bump left the environment reporting
 * "ready" while running month-old code. Hashing the sources needs no
 * discipline at all.
 */
export const sidecarFingerprint = async (sidecarDir: string): Promise<string> => {
  const paketDir = join(sidecarDir, "ultrastar_pipeline");
  const dateien: string[] = ["pyproject.toml"];
  try {
    for (const eintrag of await readdir(paketDir, { recursive: true })) {
      const name = String(eintrag).replaceAll("\\", "/");
      if (name.endsWith(".py")) dateien.push(`ultrastar_pipeline/${name}`);
    }
  } catch {
    // No package directory: the fingerprint then covers pyproject only,
    // which still changes whenever dependencies change.
  }
  dateien.sort();
  const hash = createHash("sha256");
  for (const relativ of dateien) {
    try {
      hash.update(relativ);
      hash.update(await readFile(join(sidecarDir, relativ)));
    } catch {
      // Unreadable file: its absence is part of the fingerprint.
      hash.update("<unlesbar>");
    }
  }
  return hash.digest("hex").slice(0, 16);
};

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
  bundledFingerprint: string,
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
    if (manifest.sidecarFingerprint !== bundledFingerprint) {
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
  bundledFingerprint: string;
  force?: boolean;
  language?: string;
  onProgress?: (p: InstallProgress) => void;
  runner?: Partial<InstallRunner>;
  signal?: AbortSignal;
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
      const child = spawn(cmd, args, {
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
      const runner: InstallRunner = { ...defaultRunner(opts.signal), ...opts.runner };
      const melde = (p: InstallProgress): void => opts.onProgress?.(p);
      const sprache = opts.language ?? "de";
      let torchVariante: "cu128" | "cpu" = "cpu";
      let schritt: InstallStep = "uv";
      const pruefeAbbruch = (): void => {
        if (opts.signal?.aborted) throw { schritt, detail: "Abgebrochen." };
      };
      try {
        pruefeAbbruch();
        if (runner.platform !== "win32") {
          throw new Error(
            "Automatische Einrichtung gibt es nur unter Windows. Bitte die Umgebung manuell aufsetzen (siehe python-sidecar/pyproject.toml).",
          );
        }
        if (opts.force) {
          await rm(opts.envDir, { recursive: true, force: true });
        }
        // mkdir before the disk check: on a first-ever install envDir does
        // not exist yet, so statfs on it fails with ENOENT -> freeDiskBytes
        // returns null -> the check would silently pass every time (measured
        // in the final review). uv itself would create envDir too, but later
        // steps (preload.json) write into it directly, so make sure it
        // exists up front regardless.
        await mkdir(opts.envDir, { recursive: true });
        const frei = await runner.freeDiskBytes(opts.envDir);

        // Step 1: uv. Reuse managed or PATH uv; download only as last resort.
        // The disk-space warning (if any) rides this same opening message
        // instead of its own melde() call, since a detail-less uv progress
        // event would otherwise overwrite it immediately.
        pruefeAbbruch();
        melde({
          schritt: "uv",
          prozent: null,
          detail:
            frei !== null && frei < MIN_FREE_BYTES
              ? "Wenig Plattenplatz (unter 12 GB frei) - Installation braucht ~10 GB."
              : undefined,
        });
        const uv = await ensureUv(opts.binDir, runner, melde);

        // Step 2: venv with a self-provisioned Python 3.12 (WhisperX cannot
        // run on current Python versions, so we never rely on the system one).
        schritt = "venv";
        pruefeAbbruch();
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
        pruefeAbbruch();
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
        pruefeAbbruch();
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
        pruefeAbbruch();
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
        pruefeAbbruch();
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
          sidecarFingerprint: opts.bundledFingerprint,
          pythonVersion: "3.12",
          torchVariante,
          preload: { ok: true, device: String(preload.device), datum: new Date().toISOString().slice(0, 10) },
        });
        return await Effect.runPromise(
          environmentStatus(opts.envDir, opts.bundledFingerprint),
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
          sidecarFingerprint: opts.bundledFingerprint,
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
