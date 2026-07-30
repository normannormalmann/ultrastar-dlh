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
