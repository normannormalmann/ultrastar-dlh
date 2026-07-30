import { readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { resolveDataFilePath } from "./paths.ts";

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

let memoryCache: DownloadedEntry[] | null = null;
/** Serializes writes so concurrent saves/appends don't race on read-modify-write. */
let writeChain: Promise<void> = Promise.resolve();

const readEntriesFromDisk = async (
  filePath: string,
): Promise<DownloadedEntry[]> => {
  try {
    const text = await readFile(filePath, "utf8");
    const json = JSON.parse(text);
    return Array.isArray(json) ? (json as DownloadedEntry[]) : [];
  } catch {
    return [];
  }
};

export const loadDownloadedEntries: Effect.Effect<DownloadedEntry[], Error> =
  Effect.gen(function* () {
    if (memoryCache) return memoryCache;
    const filePath = yield* resolveDataFilePath("downloaded.json");
    const entries = yield* Effect.tryPromise({
      try: () => readEntriesFromDisk(filePath),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to load downloaded entries"),
    });
    memoryCache = entries;
    return entries;
  });

export const saveDownloadedEntries = (
  entries: DownloadedEntry[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const filePath = yield* resolveDataFilePath("downloaded.json");
    yield* Effect.tryPromise({
      try: async () => {
        memoryCache = entries;
        writeChain = writeChain.then(() =>
          writeFile(filePath, JSON.stringify(entries, null, 2)),
        );
        await writeChain;
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to save downloaded entries"),
    });
  });

export const appendDownloadedEntry = (
  entry: DownloadedEntry,
): Effect.Effect<DownloadedEntry[], Error> =>
  Effect.gen(function* () {
    const filePath = yield* resolveDataFilePath("downloaded.json");
    return yield* Effect.tryPromise({
      try: async () => {
        let result: DownloadedEntry[] = [];
        writeChain = writeChain.then(async () => {
          const existing = await readEntriesFromDisk(filePath);
          const filtered = existing.filter((e) => e.apiId !== entry.apiId);
          const updated = [entry, ...filtered];
          memoryCache = updated;
          await writeFile(filePath, JSON.stringify(updated, null, 2));
          result = updated;
        });
        await writeChain;
        return result;
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to append downloaded entry"),
    });
  });
