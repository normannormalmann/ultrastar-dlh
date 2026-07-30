import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { API_URL } from "../api/usdb/config.ts";

export type FailedDownload = {
  apiId: number;
  artist: string;
  title: string;
  error: string;
  usdbUrl: string;
  timestamp: string;
};

const TXT_FILE = "failed-downloads.txt";
const JSON_FILE = "failed-downloads.json";

const formatEntry = (entry: FailedDownload): string => {
  const lines = [
    `[${entry.timestamp}]`,
    `  Song:  ${entry.artist} - ${entry.title}`,
    `  USDB:  ${entry.usdbUrl}`,
    `  Error: ${entry.error}`,
    "",
  ];
  return lines.join("\n");
};

const createEntry = (
  song: { apiId: number; artist: string; title: string },
  error: string,
): FailedDownload => ({
  apiId: song.apiId,
  artist: song.artist,
  title: song.title,
  error,
  usdbUrl: `${API_URL}/?link=detail&id=${song.apiId}`,
  timestamp: new Date().toISOString(),
});

const readEntries = async (jsonPath: string): Promise<FailedDownload[]> => {
  try {
    const text = await readFile(jsonPath, "utf8");
    const json = JSON.parse(text);
    return Array.isArray(json) ? (json as FailedDownload[]) : [];
  } catch {
    return [];
  }
};

/** Serializes writes so concurrent failures don't race on read-modify-write. */
let writeChain: Promise<void> = Promise.resolve();

export const appendFailedDownload = (
  downloadDir: string,
  song: { apiId: number; artist: string; title: string },
  error: string,
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      const entry = createEntry(song, error);

      // Append to the human-readable text log immediately.
      const txtPath = join(downloadDir, TXT_FILE);
      await appendFile(txtPath, formatEntry(entry), "utf8");

      const jsonPath = join(downloadDir, JSON_FILE);
      writeChain = writeChain
        .then(async () => {
          const existing = await readEntries(jsonPath);
          existing.push(entry);
          await writeFile(jsonPath, JSON.stringify(existing, null, 2));
        })
        .catch((e) => {
          console.error("Failed to write failed-downloads.json:", e);
        });
      await writeChain;
    },
    catch: (e) =>
      e instanceof Error ? e : new Error("Failed to append failed download"),
  });

/** All logged failed downloads (empty array if none exist yet). */
export const loadFailedDownloads = (
  downloadDir: string,
): Effect.Effect<FailedDownload[], Error> =>
  Effect.tryPromise({
    try: () => readEntries(join(downloadDir, JSON_FILE)),
    catch: (e) =>
      e instanceof Error ? e : new Error("Failed to load failed downloads"),
  });
