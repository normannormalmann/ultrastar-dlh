import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { resolveDataFilePath } from "./paths.ts";
import { atomicWrite, serializeFile, writeJson } from "./atomicFile.ts";
export type DownloadedEntry = {
  apiId: number;
  artist: string;
  title: string;
  dirName: string;
  songDir: string;
  downloadedAt: string; // ISO
  language?: string;
  genre?: string;
  edition?: string;
  creator?: string;
  year?: number;
  bpm?: number;
  realBpm?: number;
  explicit?: boolean;
};

const readEntriesFromDisk = async (
  path: string,
): Promise<DownloadedEntry[]> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !Array.isArray(value) ||
      !value.every(
        (e) =>
          e &&
          Number.isSafeInteger(e.apiId) &&
          typeof e.songDir === "string" &&
          typeof e.artist === "string" &&
          typeof e.title === "string" &&
          typeof e.dirName === "string",
      )
    )
      throw new Error("Invalid downloaded.json; refusing to overwrite it");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};
const error = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));
export const loadDownloadedEntries: Effect.Effect<DownloadedEntry[], Error> =
  Effect.gen(function* () {
    const path = yield* resolveDataFilePath("downloaded.json");
    return yield* Effect.tryPromise({
      try: () => readEntriesFromDisk(path),
      catch: error,
    });
  });
export const saveDownloadedEntries = (
  entries: DownloadedEntry[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const path = yield* resolveDataFilePath("downloaded.json");
    yield* Effect.tryPromise({
      try: () => writeJson(path, entries),
      catch: error,
    });
  });
export const updateDownloadedEntries = (
  update: (entries: DownloadedEntry[]) => DownloadedEntry[],
): Effect.Effect<DownloadedEntry[], Error> =>
  Effect.gen(function* () {
    const path = yield* resolveDataFilePath("downloaded.json");
    return yield* Effect.tryPromise({
      try: () =>
        serializeFile(path, async () => {
          const existing = await readEntriesFromDisk(path);
          const updated = update(existing);
          await atomicWrite(path, JSON.stringify(updated, null, 2));
          return updated;
        }),
      catch: error,
    });
  });

export const appendDownloadedEntry = (
  entry: DownloadedEntry,
): Effect.Effect<DownloadedEntry[], Error> =>
  updateDownloadedEntries((existing) => [
    entry,
    ...existing.filter((e) => e.songDir !== entry.songDir),
  ]);
