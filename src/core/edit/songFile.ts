// src/core/edit/songFile.ts
// Disk side of the editor: read a song.txt for editing, write it back.
// Two promises are kept here. A file someone changed meanwhile (a repair, a
// genre patch, another editor) is never overwritten blindly, and the version
// from before the first editor save survives as song.txt.bak.
import { createHash } from "node:crypto";
import { access, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import {
  BOM,
  headerValue,
  parseSongTxt,
  SongTxtError,
  type SongTxtErrorCode,
  serializeSongTxt,
  type SongTxt,
  withoutHeader,
  withTrack,
} from "./songTxt.ts";
import {
  applySyncHints,
  collectSyncHints,
  parseSyncHints,
  SYNC_HINTS_FILE,
  serializeSyncHints,
} from "./syncHints.ts";

export const SONG_FILE = "song.txt";
export const BACKUP_FILE = "song.txt.bak";

export type SongFileErrorCode =
  | SongTxtErrorCode
  | "notFound"
  | "changedOnDisk"
  | "writeFailed";

export type SongFileError = { code: SongFileErrorCode; line?: number };

export type LoadedSong = {
  song: SongTxt;
  /** Hash of the bytes read - the save checks the file still has it. */
  revision: string;
  /** Absolute path of the audio named in #MP3/#AUDIO, if it exists inside the folder. */
  audioPath: string | null;
  /** The file was not UTF-8; saving will convert it. */
  converted: boolean;
};

const vorhanden = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * USDB files from before the UTF-8 era are Windows-1252. A fatal UTF-8
 * decode tells the two apart; the rare mojibake file that happens to be
 * valid UTF-8 is read as what it claims to be.
 */
export const decodeSongBytes = (
  bytes: Uint8Array,
): { text: string; bom: boolean; converted: boolean } => {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const rumpf = bom ? bytes.subarray(3) : bytes;
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(rumpf),
      bom,
      converted: false,
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(rumpf),
      bom: false,
      converted: true,
    };
  }
};

/**
 * The header value comes from a downloaded file: "#MP3:..\..\x" must not
 * point the media protocol anywhere outside the song folder.
 */
export const mediaInside = (songDir: string, name: string | undefined): string | null => {
  const sauber = name?.trim();
  if (!sauber) return null;
  const ziel = resolve(songDir, sauber);
  const rel = relative(resolve(songDir), ziel);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return ziel;
};

/**
 * Only created songs have hints, and those are solo: a duet would leave no
 * way to tell which track a range belongs to. Never fails - without the
 * file the song simply has no markers.
 */
const mitHinweisen = async (songDir: string, song: SongTxt): Promise<SongTxt> => {
  const spur = song.tracks[0];
  if (song.tracks.length !== 1 || !spur) return song;
  try {
    const roh = await readFile(join(songDir, SYNC_HINTS_FILE), "utf8");
    return withTrack(song, 0, applySyncHints(spur, parseSyncHints(JSON.parse(roh))));
  } catch {
    return song;
  }
};

/**
 * The hints as they stand after editing. Nothing left - everything checked -
 * removes the file, so the folder is as clean as a downloaded song's.
 */
const schreibeHinweise = async (songDir: string, song: SongTxt): Promise<void> => {
  const pfad = join(songDir, SYNC_HINTS_FILE);
  const spur = song.tracks[0];
  const hints = song.tracks.length === 1 && spur ? collectSyncHints(spur) : [];
  if (hints.length > 0) {
    await writeFile(pfad, serializeSyncHints(hints), "utf8");
  } else if (await vorhanden(pfad)) {
    await rm(pfad, { force: true });
  }
};

const alsFehler = (e: unknown): SongFileError =>
  e instanceof SongTxtError
    ? { code: e.code, ...(e.line !== undefined ? { line: e.line } : {}) }
    : { code: "badValue" };

export const loadSongForEdit = (
  songDir: string,
  exists: (p: string) => boolean,
): Effect.Effect<LoadedSong, SongFileError> =>
  Effect.gen(function* () {
    const bytes = yield* Effect.tryPromise({
      try: () => readFile(join(songDir, SONG_FILE)),
      catch: (): SongFileError => ({ code: "notFound" }),
    });
    const { text, converted } = decodeSongBytes(bytes);
    const roh = yield* Effect.try({
      try: () => parseSongTxt(text),
      catch: alsFehler,
    });
    const song = yield* Effect.promise(() => mitHinweisen(songDir, roh));
    // #AUDIO replaces #MP3 in format 1.1; older files only know #MP3.
    const kandidat = mediaInside(
      songDir,
      headerValue(song, "AUDIO") ?? headerValue(song, "MP3"),
    );
    return {
      song,
      revision: hash(bytes),
      audioPath: kandidat !== null && exists(kandidat) ? kandidat : null,
      converted,
    };
  });

export const saveEditedSong = (
  songDir: string,
  song: SongTxt,
  revision: string,
): Effect.Effect<{ revision: string }, SongFileError> =>
  Effect.gen(function* () {
    const pfad = join(songDir, SONG_FILE);
    const aktuell = yield* Effect.tryPromise({
      try: () => readFile(pfad),
      catch: (): SongFileError => ({ code: "notFound" }),
    });
    if (hash(aktuell) !== revision) {
      return yield* Effect.fail<SongFileError>({ code: "changedOnDisk" });
    }
    const { bom, converted } = decodeSongBytes(aktuell);
    // Always written as UTF-8, so any other #ENCODING would make the game
    // decode it wrongly - also on a second save, or for an ASCII-only file
    // that claimed CP1252 and now gets its first umlaut.
    // Inside the try: song comes over IPC and may not even have headers.
    const text = yield* Effect.try({
      try: () =>
        serializeSongTxt(
          /^\s*utf-?8\s*$/i.test(headerValue(song, "ENCODING") ?? "utf8")
            ? song
            : withoutHeader(song, "ENCODING"),
        ),
      catch: alsFehler,
    });
    // A converted file gets a BOM: without it, games that guess the
    // encoding may keep reading it as Windows-1252.
    const neu = Buffer.from((bom || converted ? BOM : "") + text, "utf8");
    const tmp = `${pfad}.tmp`;
    yield* Effect.tryPromise({
      try: async () => {
        // Only the first save backs up. Overwriting it each time would leave
        // nothing but the previous save of this session - the hand-made
        // original the user may want back would be gone after two saves.
        const backup = join(songDir, BACKUP_FILE);
        if (!(await vorhanden(backup))) await copyFile(pfad, backup);
        try {
          await writeFile(tmp, neu);
          await rename(tmp, pfad);
        } catch (e) {
          // A game holding song.txt open makes the rename fail on Windows.
          await rm(tmp, { force: true });
          throw e;
        }
      },
      catch: (): SongFileError => ({ code: "writeFailed" }),
    });
    // After song.txt, and never failing the save: the song is what counts,
    // a lost marker file only costs the markers.
    yield* Effect.promise(() => schreibeHinweise(songDir, song).catch(() => {}));
    return { revision: hash(neu) };
  });
