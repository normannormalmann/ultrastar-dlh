import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  envPythonBin,
  environmentStatus,
  installEnvironment,
  resolvePythonBin,
  sidecarFingerprint,
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
  sidecarFingerprint: "abc123",
  pythonVersion: "3.12.8",
  torchVariante: "cu128" as const,
  preload: { ok: true, device: "cuda", datum: "2026-07-30" },
};

describe("sidecarFingerprint", () => {
  it("changes when sidecar source changes, stays stable otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sidecar-"));
    await mkdir(join(dir, "ultrastar_pipeline"), { recursive: true });
    await writeFile(join(dir, "pyproject.toml"), 'version = "0.1.0"', "utf8");
    const modul = join(dir, "ultrastar_pipeline", "worker.py");
    await writeFile(modul, "print('alt')", "utf8");

    const vorher = await sidecarFingerprint(dir);
    expect(await sidecarFingerprint(dir)).toBe(vorher);

    // A code change alone must flip the fingerprint - that is the whole
    // point: the version string stayed "0.1.0" in the measured incident.
    await writeFile(modul, "print('neu')", "utf8");
    expect(await sidecarFingerprint(dir)).not.toBe(vorher);
  });
});

describe("environmentStatus", () => {
  it("reports missing without a manifest or python", async () => {
    const envDir = await tempEnv();
    const s = await Effect.runPromise(environmentStatus(envDir, "abc123"));
    expect(s.state).toBe("missing");
  });

  it("reports missing when the manifest exists but python is gone", async () => {
    const envDir = await tempEnv();
    await mkdir(envDir, { recursive: true });
    await writeManifest(envDir, baseManifest);
    const s = await Effect.runPromise(environmentStatus(envDir, "abc123"));
    expect(s.state).toBe("missing");
  });

  it("reports ready when manifest and python match", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await writeManifest(envDir, baseManifest);
    const s = await Effect.runPromise(environmentStatus(envDir, "abc123"));
    expect(s.state).toBe("ready");
    expect(s.torchVariante).toBe("cu128");
    expect(s.pythonVersion).toBe("3.12.8");
  });

  it("reports outdated when the bundled sidecar is newer", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await writeManifest(envDir, baseManifest);
    const s = await Effect.runPromise(environmentStatus(envDir, "anders99"));
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
    const s = await Effect.runPromise(environmentStatus(envDir, "abc123"));
    expect(s.state).toBe("broken");
    expect(s.fehler?.schritt).toBe("torch");
  });

  it("treats an unreadable manifest as missing instead of throwing", async () => {
    const envDir = await tempEnv();
    await fakePython(envDir);
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "env.json"), "kein json", "utf8");
    const s = await Effect.runPromise(environmentStatus(envDir, "abc123"));
    expect(s.state).toBe("missing");
  });
});

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
    if (args[0] === "venv") {
      // Simulate what real `uv venv` does on disk, since the installer's
      // "ready" status depends on Scripts/python.exe actually existing.
      const dir = args[args.length - 1] as string;
      await mkdir(join(dir, "Scripts"), { recursive: true });
      await writeFile(envPythonBin(dir), "", "utf8");
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
  bundledFingerprint: "abc123",
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
    const status = await Effect.runPromise(environmentStatus(envDir, "abc123"));
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

  it("aborts before running when the signal is already aborted", async () => {
    const envDir = await tempEnv();
    const { runner } = fakeRunner();
    const controller = new AbortController();
    controller.abort();
    const ergebnis = await Effect.runPromise(
      Effect.either(
        installEnvironment({
          ...installOpts(envDir, runner),
          signal: controller.signal,
        }),
      ),
    );
    expect(ergebnis._tag).toBe("Left");
    if (ergebnis._tag === "Left") {
      expect(ergebnis.left.detail).toBe("Abgebrochen.");
    }
    const status = await Effect.runPromise(environmentStatus(envDir, "abc123"));
    expect(status.state === "broken" || status.state === "missing").toBe(true);
  });

  it("reports low disk space on the uv step's opening progress event", async () => {
    const envDir = await tempEnv();
    const { runner } = fakeRunner();
    const events: import("./environment.ts").InstallProgress[] = [];
    await Effect.runPromise(
      installEnvironment({
        ...installOpts(envDir, { ...runner, freeDiskBytes: async () => 5_000_000_000 }),
        onProgress: (p) => events.push(p),
      }),
    );
    const uvEvents = events.filter((e) => e.schritt === "uv");
    expect(uvEvents.some((e) => e.detail?.includes("Plattenplatz"))).toBe(true);
  });

  it("does not warn about disk space when there is plenty free", async () => {
    const envDir = await tempEnv();
    const { runner } = fakeRunner();
    const events: import("./environment.ts").InstallProgress[] = [];
    await Effect.runPromise(
      installEnvironment({
        ...installOpts(envDir, { ...runner, freeDiskBytes: async () => 50_000_000_000 }),
        onProgress: (p) => events.push(p),
      }),
    );
    const uvEvents = events.filter((e) => e.schritt === "uv");
    expect(uvEvents.some((e) => e.detail?.includes("Plattenplatz"))).toBe(false);
  });

  it("rejects a second install while the first is still running, then allows a third once it finished", async () => {
    const envDir = await tempEnv();
    const { runner } = fakeRunner();
    // Slow down every command of the first run so the second call is
    // guaranteed to hit the lock check while the first is still in flight.
    const langsamerRunner: Partial<import("./environment.ts").InstallRunner> = {
      ...runner,
      runCommand: async (cmd, args, onLine) => {
        await new Promise((r) => setTimeout(r, 20));
        return runner.runCommand(cmd, args, onLine);
      },
    };

    const erster = Effect.runPromise(installEnvironment(installOpts(envDir, langsamerRunner)));
    const zweiter = Effect.runPromise(
      Effect.either(installEnvironment(installOpts(envDir, fakeRunner().runner))),
    );

    const [ersterStatus, zweiterErgebnis] = await Promise.all([erster, zweiter]);

    expect(ersterStatus.state).toBe("ready");
    expect(zweiterErgebnis._tag).toBe("Left");
    if (zweiterErgebnis._tag === "Left") {
      expect(zweiterErgebnis.left.detail).toContain("laeuft bereits");
    }

    // The lock was released after the first install finished.
    const dritterStatus = await Effect.runPromise(
      installEnvironment(installOpts(envDir, fakeRunner().runner)),
    );
    expect(dritterStatus.state).toBe("ready");
  });
});

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
    const envDir = await tempEnv();
    expect(resolvePythonBin(undefined, envDir)).toBe("python");
    expect(resolvePythonBin(undefined, undefined)).toBe("python");
  });
});
