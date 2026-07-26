// src/core/create/pipeline.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { runPipeline } from "./pipeline.ts";

/** Ersatz-Sidecar: ein .ts-Skript, das den echten Python-Prozess vertritt. */
const fakeSidecar = async (koerper: string): Promise<{ bin: string; dir: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  const skript = join(dir, "fake.ts");
  await writeFile(skript, koerper, "utf8");
  return { bin: skript, dir };
};

const basis = (dir: string) => ({
  audioPath: join(dir, "a.wav"),
  lyricsPath: join(dir, "l.txt"),
  language: "de",
  outPath: join(dir, "out.json"),
});

const gueltigesJson = JSON.stringify({
  schemaVersion: 1,
  bpm: 120,
  gap: 0,
  language: "de",
  notes: [{ beat: 0, length: 4, pitch: 5, syllable: "Hal", confidence: 0.9 }],
  lineBreaks: [],
  meta: {
    durationSec: 1,
    device: "cpu",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
});

describe("runPipeline", () => {
  it("liest Fortschritt, ignoriert Log-Rauschen und liefert validierte Daten", async () => {
    const { bin, dir } = await fakeSidecar(`
      const out = process.argv[process.argv.indexOf("--out") + 1];
      console.log('@@PROGRESS {"stage":"separate","percent":0.5}');
      console.log("irgendein torch-Rauschen, das ignoriert werden muss");
      console.log('@@PROGRESS {"stage":"notes","percent":1}');
      await Bun.write(out, ${JSON.stringify(gueltigesJson)});
    `);
    const gesehen: string[] = [];
    const daten = await Effect.runPromise(
      runPipeline({ ...basis(dir), pythonBin: bin, onProgress: (s) => gesehen.push(s) }),
    );
    expect(daten.bpm).toBe(120);
    expect(gesehen).toEqual(["separate", "notes"]);
  });

  it("bildet @@ERROR auf typisierte Fehler ab", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"language_unsupported","language":"is"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    expect(e._tag).toBe("Left");
    if (e._tag === "Left") expect(e.left.kind).toBe("LanguageUnsupported");
  });

  it("bildet device_error ab", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"device_error","detail":"voll"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("DeviceError");
    else throw new Error("haette fehlschlagen muessen");
  });

  it("meldet ContractMismatch bei falscher schemaVersion", async () => {
    const { bin, dir } = await fakeSidecar(`
      const out = process.argv[process.argv.indexOf("--out") + 1];
      await Bun.write(out, JSON.stringify({ schemaVersion: 99 }));
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("ContractMismatch");
    else throw new Error("haette fehlschlagen muessen");
  });

  it("meldet Cancelled bei Abbruch", async () => {
    const { bin, dir } = await fakeSidecar(`await new Promise((r) => setTimeout(r, 5000));`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin, signal: controller.signal })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("Cancelled");
    else throw new Error("haette abbrechen muessen");
  });

  it("meldet EnvMissing, wenn der Interpreter fehlt", async () => {
    const { dir } = await fakeSidecar("");
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: "/gibt/es/nicht/python" })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("EnvMissing");
    else throw new Error("haette fehlschlagen muessen");
  });
});
