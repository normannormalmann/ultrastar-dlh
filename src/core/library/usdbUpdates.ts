import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { getLyricsById, type ParsedLyrics } from "../api/usdb/lyrics.ts";
import { decodeSongBytes } from "../edit/songFile.ts";
import {
  headerValue,
  parseSongTxt,
  serializeSongTxt,
  withHeader,
  withoutHeader,
} from "../edit/songTxt.ts";
import { atomicWrite, serializeFile } from "../storage/atomicFile.ts";

export const USDB_SOURCE_FILE = "usdbSource.json";
export const revisionOf = (text: string | Uint8Array): string =>
  createHash("sha256").update(text).digest("hex");
export const remoteRevision = (parsed: NonNullable<ParsedLyrics>): string =>
  revisionOf(
    JSON.stringify({
      headers: Object.entries(parsed.headers).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
      lyrics: parsed.lyrics.replace(/\r/g, "").trim(),
    }),
  );
export type UsdbUpdate = {
  songDir: string;
  artist: string;
  title: string;
  status: "current" | "available" | "unknown" | "error";
  message?: string;
  localRevision?: string;
  remoteRevision?: string;
  localChanged?: boolean;
  conflict?: boolean;
  localText?: string;
  baseText?: string;
};
export type UsdbCandidate = {
  text: string;
  localRevision: string;
  remoteRevision: string;
  apiId: number;
  remoteText?: string;
};

export const remoteTextOf = (remote: NonNullable<ParsedLyrics>): string =>
  `${Object.entries(remote.headers)
    .map(([key, value]) => `#${key.toUpperCase()}:${value}`)
    .join("\n")}\n${remote.lyrics.trim()}\n`;

const LOCAL_HEADERS = new Set([
  "AUDIO",
  "MP3",
  "VIDEO",
  "VIDEOGAP",
  "COVER",
  "BACKGROUND",
  "ENCODING",
  "RELATIVE",
]);

/** Compare musical content, preserving meaningful syllable spaces and duet tracks. */
export const musicalRevision = (text: string): string => {
  const song = parseSongTxt(text);
  const headers = song.headers
    .filter(({ key }) => !LOCAL_HEADERS.has(key.toUpperCase()))
    .map(({ key, value }) => [
      key.toUpperCase(),
      ["BPM", "GAP"].includes(key.toUpperCase())
        ? String(Number(value.replace(",", ".")))
        : value.trim(),
    ]);
  if (!headers.some(([key]) => key === "GAP")) headers.push(["GAP", "0"]);
  headers.sort(([a], [b]) => a!.localeCompare(b!));
  return revisionOf(JSON.stringify({ headers, tracks: song.tracks }));
};

export const sourceSnapshot = (
  apiId: number,
  remote: NonNullable<ParsedLyrics>,
) => ({
  schemaVersion: 2,
  apiId,
  remoteRevision: remoteRevision(remote),
  remoteText: remoteTextOf(remote),
  checkedAt: new Date().toISOString(),
});

/** Downloaded media keep their local names; note/timing data comes from USDB. */
export const mergeUsdbText = (
  localText: string,
  remote: NonNullable<ParsedLyrics>,
): string => {
  const local = parseSongTxt(localText);
  const remoteText = `${Object.entries(remote.headers)
    .map(([key, value]) => `#${key.toUpperCase()}:${value}`)
    .join("\n")}\n${remote.lyrics.trim()}\n`;
  let song = parseSongTxt(remoteText);
  for (const key of [
    "AUDIO",
    "MP3",
    "VIDEO",
    "VIDEOGAP",
    "COVER",
    "BACKGROUND",
  ]) {
    song = withoutHeader(song, key);
    const value = headerValue(local, key);
    if (value !== undefined) song = withHeader(song, key, value);
  }
  song = withoutHeader(song, "ENCODING");
  return serializeSongTxt(song);
};

export const checkUsdbSong = (
  songDir: string,
  apiId: number,
  cookie: string,
  fetchLyrics = getLyricsById,
): Effect.Effect<
  {
    changed: boolean | null;
    candidate: UsdbCandidate;
    localChanged: boolean;
    conflict: boolean;
    localText: string;
    baseText?: string;
  },
  Error
> =>
  Effect.gen(function* () {
    const remote = yield* fetchLyrics(apiId, cookie);
    if (!remote)
      return yield* Effect.fail(new Error("USDB liefert keine Songfassung."));
    return yield* Effect.tryPromise({
      try: async () => {
        const local = await readFile(join(songDir, "song.txt"));
        const revision = remoteRevision(remote);
        const baseline = await readFile(join(songDir, USDB_SOURCE_FILE), "utf8")
          .then(
            (text) =>
              JSON.parse(text) as {
                apiId?: number;
                remoteRevision?: string;
                remoteText?: string;
              },
          )
          .catch(() => null);
        const known = baseline?.apiId === apiId ? baseline : null;
        const localText = decodeSongBytes(local).text;
        const remoteText = remoteTextOf(remote);
        const identical =
          musicalRevision(localText) === musicalRevision(remoteText);
        const changed = identical
          ? false
          : known?.remoteRevision
            ? known.remoteRevision !== revision
            : null;
        const localChanged =
          typeof known?.remoteText === "string" &&
          musicalRevision(localText) !== musicalRevision(known.remoteText);
        if (identical || (changed === false && !known?.remoteText)) {
          await serializeFile(join(songDir, "song.txt"), async () => {
            if (
              revisionOf(await readFile(join(songDir, "song.txt"))) !==
              revisionOf(local)
            )
              return;
            await atomicWrite(
              join(songDir, USDB_SOURCE_FILE),
              JSON.stringify(sourceSnapshot(apiId, remote)),
            );
          });
        }
        return {
          changed,
          localChanged,
          conflict: changed === true && localChanged,
          localText,
          baseText: known?.remoteText,
          candidate: {
            text: mergeUsdbText(localText, remote),
            localRevision: revisionOf(local),
            remoteRevision: revision,
            apiId,
            remoteText,
          },
        };
      },
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    });
  });

/** Rechecks the exact version reviewed by the user and keeps a timestamped backup. */
export const applyUsdbCandidate = (
  songDir: string,
  candidate: UsdbCandidate,
  keepLocal = false,
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () =>
      serializeFile(join(songDir, "song.txt"), async () => {
        const path = join(songDir, "song.txt");
        if (revisionOf(await readFile(path)) !== candidate.localRevision)
          throw new Error(
            "Song wurde zwischenzeitlich bearbeitet. Bitte erneut nach Updates suchen.",
          );
        if (!keepLocal) {
          await copyFile(path, join(songDir, `song.txt.${Date.now()}.bak`));
          await atomicWrite(path, candidate.text);
        }
        await atomicWrite(
          join(songDir, USDB_SOURCE_FILE),
          JSON.stringify({
            schemaVersion: 2,
            apiId: candidate.apiId,
            remoteRevision: candidate.remoteRevision,
            remoteText: candidate.remoteText,
            checkedAt: new Date().toISOString(),
          }),
        );
      }),
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
