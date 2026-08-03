import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  type rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  assemblePackage,
  freierZielpfad,
  verschiebeStandard,
} from "./packageSong.ts";
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

describe("verschiebeStandard", () => {
  it("verschiebt einen Ordner im selben Dateisystem", async () => {
    const { library, jobDir } = await aufbau();
    const quelle = join(jobDir, "paket");
    await mkdir(quelle, { recursive: true });
    await writeFile(join(quelle, "song.txt"), "inhalt");
    const ziel = join(library, "Ziel");
    await verschiebeStandard(quelle, ziel);
    expect(await readFile(join(ziel, "song.txt"), "utf8")).toBe("inhalt");
    expect(await readdir(jobDir)).not.toContain("paket");
  });

  // rename liefert auf ein bestehendes Verzeichnis EPERM, nicht EXDEV - der
  // Kopierzweig ist ohne Injektion gar nicht erreichbar. Genau dort sitzt
  // aber der gefaehrliche Teil: cp() merged in bestehende Ordner (gemessen:
  // errorOnExist gilt nur je Datei), und der Rollback wuerde fremde Ordner
  // loeschen. Bei Bibliothek auf J: und userData auf C: ist das der Normalpfad.
  const exdev = (): never => {
    throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  };

  it("mergt im Kopierzweig nicht in einen bestehenden Ordner", async () => {
    const { library, jobDir } = await aufbau();
    const quelle = join(jobDir, "paket");
    await mkdir(quelle, { recursive: true });
    await writeFile(join(quelle, "song.txt"), "neu");
    const ziel = join(library, "Bestand");
    await mkdir(ziel, { recursive: true });
    // Kein kollidierender Name - genau der Fall, den errorOnExist durchlaesst.
    await writeFile(join(ziel, "notizen.txt"), "handkorrigiert");
    await expect(
      verschiebeStandard(quelle, ziel, exdev as unknown as typeof rename),
    ).rejects.toThrow();
    expect((await readdir(ziel)).sort()).toEqual(["notizen.txt"]);
  });

  it("loescht im Kopierzweig keinen fremden Ordner beim Aufraeumen", async () => {
    const { library, jobDir } = await aufbau();
    const quelle = join(jobDir, "paket");
    await mkdir(quelle, { recursive: true });
    await writeFile(join(quelle, "song.txt"), "neu");
    const ziel = join(library, "Bestand");
    await mkdir(ziel, { recursive: true });
    // Kollidierender Name: hier schlug cp fehl und der Rollback raeumte
    // den Ordner des Nutzers ab.
    await writeFile(join(ziel, "song.txt"), "handkorrigiert");
    await expect(
      verschiebeStandard(quelle, ziel, exdev as unknown as typeof rename),
    ).rejects.toThrow();
    expect(await readFile(join(ziel, "song.txt"), "utf8")).toBe(
      "handkorrigiert",
    );
  });

  it("kopiert ueber Laufwerksgrenzen und raeumt die Quelle weg", async () => {
    const { library, jobDir } = await aufbau();
    const quelle = join(jobDir, "paket");
    await mkdir(quelle, { recursive: true });
    await writeFile(join(quelle, "song.txt"), "inhalt");
    const ziel = join(library, "Neu");
    await verschiebeStandard(quelle, ziel, exdev as unknown as typeof rename);
    expect(await readFile(join(ziel, "song.txt"), "utf8")).toBe("inhalt");
    expect(await readdir(jobDir)).not.toContain("paket");
  });

  it("ueberschreibt einen bestehenden Ordner nicht, sondern scheitert", async () => {
    const { library, jobDir } = await aufbau();
    const quelle = join(jobDir, "paket");
    await mkdir(quelle, { recursive: true });
    await writeFile(join(quelle, "song.txt"), "neu");
    // Handkorrigierte Notenarbeit im Zielordner - die darf nichts anfassen.
    const ziel = join(library, "Bestand");
    await mkdir(ziel, { recursive: true });
    await writeFile(join(ziel, "song.txt"), "handkorrigiert");
    await expect(verschiebeStandard(quelle, ziel)).rejects.toThrow();
    expect(await readFile(join(ziel, "song.txt"), "utf8")).toBe(
      "handkorrigiert",
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
            // Fails *after* touching the target, like a copy that dies
            // halfway. A mover that throws before writing anything would
            // let this test pass no matter what the real one does.
            verschiebe: async (_von, nach) => {
              await mkdir(nach, { recursive: true });
              await writeFile(join(nach, "halb.mp4"), "halb");
              await rm(nach, { recursive: true, force: true });
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

  it("legt im Layout 'artist' die Zwischenebene an", async () => {
    const { library, jobDir } = await aufbau();
    const ergebnis = await Effect.runPromise(
      assemblePackage({ ...basis(library, jobDir), layout: "artist" }),
    );
    expect(ergebnis.songDir).toBe(
      join(library, "Interpret", "Interpret_-_Titel"),
    );
    expect(await readdir(ergebnis.songDir)).toContain("song.txt");
  });

  it("ein leerer Cover-Body zaehlt als kein Cover", async () => {
    const { library, jobDir } = await aufbau();
    const ergebnis = await Effect.runPromise(
      assemblePackage({
        ...basis(library, jobDir),
        deps: { findCoverFn: () => Effect.succeed(new Uint8Array()) },
      }),
    );
    expect(await readdir(ergebnis.songDir)).not.toContain("cover.jpg");
    const txt = await readFile(join(ergebnis.songDir, "song.txt"), "utf8");
    expect(txt).not.toContain("#COVER");
  });

  it("fragt bei gesetzter coverWahl nicht das Cover Art Archive", async () => {
    const { library, jobDir } = await aufbau();
    let gefragt = false;
    const bild = join(jobDir, "eigenes.jpg");
    await writeFile(bild, "JPEGDATEN");
    const ergebnis = await Effect.runPromise(
      assemblePackage({
        ...basis(library, jobDir),
        coverWahl: { pfad: bild },
        deps: {
          findCoverFn: () => {
            gefragt = true;
            return Effect.succeed(null);
          },
        },
      }),
    );
    expect(gefragt).toBe(false);
    expect(await readFile(join(ergebnis.songDir, "cover.jpg"), "utf8")).toBe(
      "JPEGDATEN",
    );
    expect(
      await readFile(join(ergebnis.songDir, "song.txt"), "utf8"),
    ).toContain("#COVER:cover.jpg");
  });

  it("schreibt bei coverWahl keins kein Bild und kein #COVER", async () => {
    const { library, jobDir } = await aufbau();
    const daumen = join(jobDir, "thumb.jpg");
    await writeFile(daumen, "DAUMEN");
    const grund = basis(library, jobDir);
    const ergebnis = await Effect.runPromise(
      assemblePackage({
        ...grund,
        // "keins" has to beat an available thumbnail too, not just the archive.
        medien: { ...grund.medien, coverKandidat: daumen },
        coverWahl: "keins",
      }),
    );
    expect(await readdir(ergebnis.songDir)).not.toContain("cover.jpg");
    expect(
      await readFile(join(ergebnis.songDir, "song.txt"), "utf8"),
    ).not.toContain("#COVER");
  });

  it("warnt, wenn das gewaehlte Bild verschwunden ist", async () => {
    const { library, jobDir } = await aufbau();
    const ergebnis = await Effect.runPromise(
      assemblePackage({
        ...basis(library, jobDir),
        coverWahl: { pfad: join(jobDir, "gibtsnicht.jpg") },
      }),
    );
    // Deliberately not just "ohne Bild": the old "Kein Cover gefunden"
    // warning ends in those words too, so this test would pass unimplemented.
    expect(ergebnis.warnungen.join(" ")).toContain("Gewaehltes Bild");
    expect(await readdir(ergebnis.songDir)).not.toContain("cover.jpg");
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
