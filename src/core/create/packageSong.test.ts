import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { assemblePackage, freierZielpfad } from "./packageSong.ts";
import type { SongData } from "./songData.ts";

const songData = (): SongData => ({
  schemaVersion: 2,
  bpm: 120,
  gap: 0,
  language: "de",
  notes: [{ beat: 0, length: 4, pitch: 60, syllable: "La" }],
  lineBreaks: [],
  sections: [],
  meta: {
    durationSec: 10,
    device: "cpu",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
});

const aufbau = async () => {
  const wurzel = await mkdtemp(join(tmpdir(), "paket-test-"));
  const library = join(wurzel, "library");
  const jobDir = join(wurzel, "job");
  await mkdir(library, { recursive: true });
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, "video.mp4"), "video");
  return { library, jobDir };
};

const basis = (library: string, jobDir: string) => ({
  songData: songData(),
  medien: {
    audioPath: join(jobDir, "audio.m4a"),
    videoPath: join(jobDir, "video.mp4"),
  },
  meta: { artist: "Interpret", title: "Titel" },
  libraryDir: library,
  layout: "flat" as const,
  jobDir,
  deps: { findCoverFn: () => Effect.succeed(null) },
});

describe("freierZielpfad", () => {
  it("haengt ein Suffix an, statt einen bestehenden Ordner anzufassen", async () => {
    const { library } = await aufbau();
    await mkdir(join(library, "Interpret - Titel"), { recursive: true });
    const ergebnis = await freierZielpfad(library, "Interpret - Titel");
    expect(ergebnis.dirName).toBe("Interpret - Titel (2)");
  });

  it("zaehlt weiter, wenn auch die Zweitfassung existiert", async () => {
    const { library } = await aufbau();
    await mkdir(join(library, "Interpret - Titel"), { recursive: true });
    await mkdir(join(library, "Interpret - Titel (2)"), { recursive: true });
    expect((await freierZielpfad(library, "Interpret - Titel")).dirName).toBe(
      "Interpret - Titel (3)",
    );
  });
});

describe("assemblePackage", () => {
  it("baut einen vollstaendigen Ordner mit song.txt und Video", async () => {
    const { library, jobDir } = await aufbau();
    const ergebnis = await Effect.runPromise(
      assemblePackage(basis(library, jobDir)),
    );
    // sanitizeForPath turns blanks into underscores - the same folder form
    // USDB downloads get, so created songs sit beside them consistently.
    expect(ergebnis.dirName).toBe("Interpret_-_Titel");
    const dateien = (await readdir(ergebnis.songDir)).sort();
    expect(dateien).toEqual(["song.txt", "video.mp4"]);
    const txt = await readFile(join(ergebnis.songDir, "song.txt"), "utf8");
    expect(txt).toContain("#TITLE:Titel");
    expect(txt).toContain("#MP3:video.mp4");
    expect(txt).toContain("#VIDEO:video.mp4");
  });

  it("schreibt das Cover und setzt den Header", async () => {
    const { library, jobDir } = await aufbau();
    const ergebnis = await Effect.runPromise(
      assemblePackage({
        ...basis(library, jobDir),
        deps: { findCoverFn: () => Effect.succeed(new Uint8Array([7])) },
      }),
    );
    expect(await readFile(join(ergebnis.songDir, "cover.jpg"))).toEqual(
      Buffer.from([7]),
    );
    const txt = await readFile(join(ergebnis.songDir, "song.txt"), "utf8");
    expect(txt).toContain("#COVER:cover.jpg");
  });

  it("ohne Cover kommt eine Warnung und kein #COVER", async () => {
    const { library, jobDir } = await aufbau();
    const ergebnis = await Effect.runPromise(
      assemblePackage(basis(library, jobDir)),
    );
    expect(ergebnis.warnungen.some((w) => w.includes("Cover"))).toBe(true);
    const txt = await readFile(join(ergebnis.songDir, "song.txt"), "utf8");
    expect(txt).not.toContain("#COVER");
  });

  it("laesst bei einem Fehler keinen halben Ordner in der Bibliothek", async () => {
    const { library, jobDir } = await aufbau();
    const fehler = await Effect.runPromise(
      Effect.either(
        assemblePackage({
          ...basis(library, jobDir),
          deps: {
            findCoverFn: () => Effect.succeed(null),
            verschiebe: async () => {
              throw new Error("Laufwerk voll");
            },
          },
        }),
      ),
    );
    expect(fehler._tag).toBe("Left");
    if (fehler._tag === "Left") expect(fehler.left.kind).toBe("MoveFailed");
    expect(await readdir(library)).toEqual([]);
  });

  it("legt im Datei-Eingang die Tonspur ins Paket und laesst #VIDEO weg", async () => {
    const { library, jobDir } = await aufbau();
    const eigene = join(jobDir, "eigene.mp3");
    await writeFile(eigene, "ton");
    const ergebnis = await Effect.runPromise(
      assemblePackage({
        ...basis(library, jobDir),
        medien: { audioPath: eigene },
      }),
    );
    const dateien = (await readdir(ergebnis.songDir)).sort();
    expect(dateien).toEqual(["audio.mp3", "song.txt"]);
    const txt = await readFile(join(ergebnis.songDir, "song.txt"), "utf8");
    expect(txt).toContain("#MP3:audio.mp3");
    expect(txt).not.toContain("#VIDEO");
  });
});
