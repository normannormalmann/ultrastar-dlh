// src/core/edit/songFile.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { markChecked, type NotePatch, shiftFrom, updateNote } from "./noteEdits.ts";
import { SYNC_HINTS_FILE } from "./syncHints.ts";
import { type SongTxt, type Track, withTrack } from "./songTxt.ts";
import {
  BACKUP_FILE,
  decodeSongBytes,
  loadSongForEdit,
  mediaInside,
  SONG_FILE,
  saveEditedSong,
} from "./songFile.ts";

const TXT = "#TITLE:Lied\n#ARTIST:Wer\n#MP3:audio.mp3\n#BPM:300\n#GAP:0\n: 0 4 5 Hal\n: 4 4 7 lo\nE\n";

let dir: string;

/** The tests edit the only track; the model holds a list of them. */
const aendere = (s: SongTxt, i: number, patch: NotePatch): SongTxt =>
  withTrack(s, 0, updateNote(s.tracks[0] as Track, i, patch));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "songfile-"));
  await writeFile(join(dir, SONG_FILE), TXT, "utf8");
  await writeFile(join(dir, "audio.mp3"), "x");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const lade = () => Effect.runPromise(loadSongForEdit(dir, existsSync));

describe("loadSongForEdit", () => {
  it("liest Song, Revision und den Audiopfad", async () => {
    const geladen = await lade();
    expect(geladen.song.tracks[0]?.notes).toHaveLength(2);
    expect(geladen.revision).toHaveLength(64);
    expect(geladen.audioPath).toBe(join(dir, "audio.mp3"));
    expect(geladen.converted).toBe(false);
  });

  it("liefert einen Code statt eines Satzes, wenn die Datei fehlt", async () => {
    await rm(join(dir, SONG_FILE));
    const e = await Effect.runPromise(Effect.either(loadSongForEdit(dir, existsSync)));
    expect(Either.isLeft(e) && e.left).toEqual({ code: "notFound" });
  });

  it("reicht Parserfehler mit Zeile durch", async () => {
    await writeFile(join(dir, SONG_FILE), "#TITLE:x\n#BPM:1\n: 0 1 1 a\nQuatsch\nE\n");
    const e = await Effect.runPromise(Effect.either(loadSongForEdit(dir, existsSync)));
    expect(Either.isLeft(e) && e.left).toEqual({ code: "badLine", line: 4 });
  });
});

describe("Hinweise auf unsichere Stellen", () => {
  const hinweise = (hints: unknown[]) =>
    writeFile(join(dir, SYNC_HINTS_FILE), JSON.stringify({ version: 1, hints }), "utf8");

  it("markiert beim Laden die Noten in den Bereichen", async () => {
    await hinweise([{ fromBeat: 4, toBeat: 8, kind: "interpolated" }]);
    const noten = (await lade()).song.tracks[0]?.notes ?? [];
    expect(noten.map((n) => n.unsure)).toEqual([undefined, "interpolated"]);
  });

  it("schreibt die Bereiche mit den neuen Beats zurueck", async () => {
    await hinweise([{ fromBeat: 4, toBeat: 8, kind: "low" }]);
    const geladen = await lade();
    const verschoben = withTrack(
      geladen.song,
      0,
      shiftFrom(geladen.song.tracks[0] as Track, 1, 2),
    );
    await Effect.runPromise(saveEditedSong(dir, verschoben, geladen.revision));
    const datei = JSON.parse(await readFile(join(dir, SYNC_HINTS_FILE), "utf8"));
    expect(datei.hints).toEqual([{ fromBeat: 6, toBeat: 10, kind: "low" }]);
    // song.txt itself carries no trace of the markers.
    expect(await readFile(join(dir, SONG_FILE), "utf8")).toContain(": 6 4 7 lo\nE\n");
  });

  it("loescht die Datei, wenn alles abgehakt ist", async () => {
    await hinweise([{ fromBeat: 4, toBeat: 8, kind: "low" }]);
    const geladen = await lade();
    const geprueft = withTrack(geladen.song, 0, markChecked(geladen.song.tracks[0] as Track, 1));
    await Effect.runPromise(saveEditedSong(dir, geprueft, geladen.revision));
    expect(existsSync(join(dir, SYNC_HINTS_FILE))).toBe(false);
  });

  it("uebersteht eine kaputte Hinweisdatei", async () => {
    await writeFile(join(dir, SYNC_HINTS_FILE), "{kaputt", "utf8");
    expect((await lade()).song.tracks[0]?.notes.some((n) => n.unsure)).toBe(false);
  });
});

describe("saveEditedSong", () => {
  it("schreibt, legt ein Backup an und liefert die neue Revision", async () => {
    const geladen = await lade();
    const neu = aendere(geladen.song, 0, { pitch: 9 });
    const { revision } = await Effect.runPromise(
      saveEditedSong(dir, neu, geladen.revision),
    );
    expect(await readFile(join(dir, SONG_FILE), "utf8")).toContain(": 0 4 9 Hal");
    expect(await readFile(join(dir, BACKUP_FILE), "utf8")).toBe(TXT);
    expect((await lade()).revision).toBe(revision);
  });

  it("ueberschreibt keine Datei, die sich inzwischen geaendert hat", async () => {
    const geladen = await lade();
    await writeFile(join(dir, SONG_FILE), `${TXT}\n`, "utf8");
    const e = await Effect.runPromise(
      Effect.either(saveEditedSong(dir, geladen.song, geladen.revision)),
    );
    expect(Either.isLeft(e) && e.left).toEqual({ code: "changedOnDisk" });
    expect(existsSync(join(dir, BACKUP_FILE))).toBe(false);
  });

  it("wandelt Windows-1252 in UTF-8 mit BOM und entfernt #ENCODING", async () => {
    const cp1252 = Buffer.from(
      "#TITLE:Gr\xfc\xdfe\n#ENCODING:CP1252\n#BPM:300\n: 0 4 5 S\xfc\nE\n",
      "latin1",
    );
    await writeFile(join(dir, SONG_FILE), cp1252);
    const geladen = await lade();
    expect(geladen.converted).toBe(true);
    expect(geladen.song.headers[0]?.value).toBe("Grüße");
    await Effect.runPromise(saveEditedSong(dir, geladen.song, geladen.revision));
    const bytes = await readFile(join(dir, SONG_FILE));
    const { text, bom } = decodeSongBytes(bytes);
    expect(bom).toBe(true);
    expect(text).toContain("#TITLE:Grüße");
    expect(text).not.toContain("#ENCODING");
  });

  it("ueberschreibt das Backup beim zweiten Speichern nicht", async () => {
    let geladen = await lade();
    await Effect.runPromise(
      saveEditedSong(dir, aendere(geladen.song, 0, { pitch: 1 }), geladen.revision),
    );
    geladen = await lade();
    await Effect.runPromise(
      saveEditedSong(dir, aendere(geladen.song, 0, { pitch: 2 }), geladen.revision),
    );
    expect(await readFile(join(dir, BACKUP_FILE), "utf8")).toBe(TXT);
  });

  it("entfernt #ENCODING:CP1252 auch bei einer reinen ASCII-Datei", async () => {
    await writeFile(join(dir, SONG_FILE), `#ENCODING:CP1252\n${TXT}`, "utf8");
    const geladen = await lade();
    expect(geladen.converted).toBe(false);
    const mitUmlaut = aendere(geladen.song, 0, { syllable: "für" });
    await Effect.runPromise(saveEditedSong(dir, mitUmlaut, geladen.revision));
    const text = await readFile(join(dir, SONG_FILE), "utf8");
    expect(text).not.toContain("#ENCODING");
    expect(text).toContain(": 0 4 5 für");
  });

  it("laesst #ENCODING:UTF8 stehen", async () => {
    await writeFile(join(dir, SONG_FILE), `#ENCODING:UTF8\n${TXT}`, "utf8");
    const geladen = await lade();
    await Effect.runPromise(saveEditedSong(dir, geladen.song, geladen.revision));
    expect(await readFile(join(dir, SONG_FILE), "utf8")).toContain("#ENCODING:UTF8");
  });

  it("behaelt ein vorhandenes BOM", async () => {
    await writeFile(join(dir, SONG_FILE), `\uFEFF${TXT}`, "utf8");
    const geladen = await lade();
    await Effect.runPromise(saveEditedSong(dir, geladen.song, geladen.revision));
    expect(decodeSongBytes(await readFile(join(dir, SONG_FILE))).bom).toBe(true);
  });
});

describe("mediaInside", () => {
  it("laesst nur Dateien im Songordner zu", () => {
    expect(mediaInside(dir, "audio.mp3")).toBe(join(dir, "audio.mp3"));
    expect(mediaInside(dir, "..\\..\\geheim.txt")).toBeNull();
    expect(mediaInside(dir, "../geheim.txt")).toBeNull();
    expect(mediaInside(dir, "C:\\Windows\\win.ini")).toBeNull();
    expect(mediaInside(dir, "  ")).toBeNull();
    expect(mediaInside(dir, undefined)).toBeNull();
  });
});
