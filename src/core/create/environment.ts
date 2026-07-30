// Managed Python environment for the sidecar (subproject 2). Pure logic:
// status is derived from a manifest file, installation runs through
// injectable runners so tests never touch uv, the network, or a GPU.
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
