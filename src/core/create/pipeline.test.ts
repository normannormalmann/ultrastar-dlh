// src/core/create/pipeline.test.ts
import { existsSync } from "node:fs";
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
  schemaVersion: 2,
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

  it("meldet Cancelled sofort, wenn das Signal schon beim Aufruf abgebrochen ist", async () => {
    const { bin, dir } = await fakeSidecar(
      `await new Promise((r) => setTimeout(r, 5000));`,
    );
    const controller = new AbortController();
    controller.abort();
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin, signal: controller.signal })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("Cancelled");
    else throw new Error("haette abbrechen muessen");
  });

  it("nennt bei language_unsupported die betroffene Sprache im detail", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"language_unsupported","language":"is"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") {
      expect(e.left.kind).toBe("LanguageUnsupported");
      expect(e.left.detail).toContain("is");
    } else throw new Error("haette fehlschlagen muessen");
  });

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

  it("listet bei lyrics_unresolved die gefundenen Marker im detail auf", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"lyrics_unresolved","markers":["(2x)","[chorus]"]}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") {
      expect(e.left.kind).toBe("PipelineFailed");
      expect(e.left.detail).toContain("(2x)");
      expect(e.left.detail).toContain("[chorus]");
    } else throw new Error("haette fehlschlagen muessen");
  });

  it("bildet env_missing ab und nennt das fehlende Paket im detail", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"env_missing","module":"whisperx"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") {
      expect(e.left.kind).toBe("EnvMissing");
      expect(e.left.detail).toContain("whisperx");
    } else throw new Error("haette fehlschlagen muessen");
  });

  it("puffert eine Marker-Zeile, die auf zwei Schreibvorgaenge aufgeteilt ist", async () => {
    const { bin, dir } = await fakeSidecar(`
      process.stdout.write('@@PROGRESS {"stage":"searc');
      await new Promise((r) => setTimeout(r, 50));
      console.log('h","percent":0.3}');
    `);
    const gesehen: Array<[string, number]> = [];
    await Effect.runPromise(
      Effect.either(
        runPipeline({
          ...basis(dir),
          pythonBin: bin,
          onProgress: (s, p) => gesehen.push([s, p]),
        }),
      ),
    );
    expect(gesehen).toEqual([["search", 0.3]]);
  });

  it("ignoriert eine defekte Fortschritts-Zeile und laeuft trotzdem durch", async () => {
    const { bin, dir } = await fakeSidecar(`
      const out = process.argv[process.argv.indexOf("--out") + 1];
      console.log('@@PROGRESS nicht-json');
      await Bun.write(out, ${JSON.stringify(gueltigesJson)});
    `);
    const daten = await Effect.runPromise(runPipeline({ ...basis(dir), pythonBin: bin }));
    expect(daten.bpm).toBe(120);
  });

  it("bildet einen unbekannten Fehler-kind auf PipelineFailed ab", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"irgendwas_unbekanntes","detail":"?"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("PipelineFailed");
    else throw new Error("haette fehlschlagen muessen");
  });

  it("meldet PipelineFailed mit sichtbarem Exitcode, wenn keine @@ERROR-Zeile kommt", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log("nur Log-Rauschen, kein Fehler-Marker");
      process.exit(3);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") {
      expect(e.left.kind).toBe("PipelineFailed");
      expect(e.left.detail).toContain("3");
    } else throw new Error("haette fehlschlagen muessen");
  });

  it("killt den Kindprozessbaum bei Abbruch — ein Enkelprozess schreibt nie", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
    const markerPath = join(dir, "enkel.txt");
    const enkelSkript = join(dir, "enkel.ts");
    await writeFile(
      enkelSkript,
      `
        await new Promise((r) => setTimeout(r, 300));
        await Bun.write(${JSON.stringify(markerPath)}, "da");
      `,
      "utf8",
    );
    const hauptSkript = join(dir, "fake.ts");
    await writeFile(
      hauptSkript,
      `
        import { spawn } from "node:child_process";
        spawn("bun", [${JSON.stringify(enkelSkript)}], { stdio: "ignore" });
        await new Promise((r) => setTimeout(r, 5000));
      `,
      "utf8",
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await Effect.runPromise(
      Effect.either(
        runPipeline({ ...basis(dir), pythonBin: hauptSkript, signal: controller.signal }),
      ),
    );
    // Grosszuegige Wartezeit ueber die 300ms des Enkels hinaus: wenn der
    // Baum nicht getoetet wurde, haette die Datei laengst existieren muessen.
    await new Promise((r) => setTimeout(r, 800));
    expect(existsSync(markerPath)).toBe(false);
  });
});
