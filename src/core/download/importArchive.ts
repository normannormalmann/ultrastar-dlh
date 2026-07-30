import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  type DownloadedEntry,
  loadDownloadedEntries,
  saveDownloadedEntries,
} from "../storage/downloaded.ts";
import { parseTxtHeaders, stableHash, type TxtHeaders } from "./repairSongs.ts";

export type ImportResult = {
  imported: number;
  importedWithoutVideo: number;
  skipped: number;
  refreshed: number;
};

export type ImportProgress = { current: number; total: number };

/** Folders checked in parallel per wave — I/O-bound, speeds up large archives significantly. */
const SCAN_CONCURRENCY = 32;

/** Only the metadata fields of a header set (without artist/title). */
export const entryMetadata = (h: TxtHeaders): Partial<DownloadedEntry> => ({
  ...(h.language ? { language: h.language } : {}),
  ...(h.genre ? { genre: h.genre } : {}),
  ...(h.edition ? { edition: h.edition } : {}),
  ...(h.creator ? { creator: h.creator } : {}),
  ...(h.year !== undefined ? { year: h.year } : {}),
  ...(h.bpm !== undefined ? { bpm: h.bpm } : {}),
});

type ProbeResult =
  | { kind: "song"; entry: DownloadedEntry; hasVideo: boolean }
  | { kind: "refresh"; dirName: string; meta: TxtHeaders }
  | { kind: "skipped" }
  | { kind: "not-a-song" };

const readHeaders = async (songDir: string): Promise<TxtHeaders | null> => {
  try {
    return parseTxtHeaders(await readFile(join(songDir, "song.txt"), "utf8"));
  } catch {
    return null;
  }
};

const hasSongTxt = async (dir: string): Promise<boolean> => {
  try {
    await stat(join(dir, "song.txt"));
    return true;
  } catch {
    return false;
  }
};

const probeNewFolder = async (
  songDir: string,
  name: string,
): Promise<ProbeResult> => {
  const meta = await readHeaders(songDir);
  if (meta === null) return { kind: "not-a-song" };

  let hasVideo = false;
  try {
    hasVideo = (await stat(join(songDir, "video.mp4"))).size > 0;
  } catch {
    // no video → hasVideo stays false
  }

  return {
    kind: "song",
    hasVideo,
    entry: {
      apiId: stableHash(name),
      artist: meta.artist || name,
      title: meta.title || name,
      dirName: name,
      songDir,
      downloadedAt: new Date().toISOString(),
      ...entryMetadata(meta),
    },
  };
};

/**
 * Bring an existing archive into tracking — without network access.
 * New song folders are imported; already-tracked entries WITHOUT a
 * language field get their metadata backfilled (counts as refreshed).
 */
export const importArchive = (
  downloadDir: string,
  onProgress?: (p: ImportProgress) => void,
): Effect.Effect<ImportResult, Error> =>
  Effect.gen(function* () {
    const candidates = yield* Effect.tryPromise({
      try: async () => {
        const result: Array<{ name: string; songDir: string }> = [];
        const top = await readdir(downloadDir, { withFileTypes: true });
        for (const d of top.filter((x) => x.isDirectory())) {
          const dir = join(downloadDir, d.name);
          if (await hasSongTxt(dir)) {
            result.push({ name: d.name, songDir: dir });
            continue;
          }
          // Search one level deeper (artist/letter layouts)
          const sub = await readdir(dir, { withFileTypes: true });
          for (const s of sub.filter((x) => x.isDirectory())) {
            const subDir = join(dir, s.name);
            if (await hasSongTxt(subDir)) {
              result.push({ name: s.name, songDir: subDir });
            }
          }
        }
        return result;
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to read download dir"),
    });

    const existing = yield* loadDownloadedEntries;
    const trackedByName = new Map(existing.map((e) => [e.dirName, e]));

    const total = candidates.length;
    let importedWithoutVideo = 0;
    let skipped = 0;
    const newEntries: DownloadedEntry[] = [];
    const refreshMeta = new Map<string, TxtHeaders>();

    for (let i = 0; i < candidates.length; i += SCAN_CONCURRENCY) {
      const chunk = candidates.slice(i, i + SCAN_CONCURRENCY);
      const results = yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            chunk.map(async (candidate): Promise<ProbeResult> => {
              const { name, songDir } = candidate;
              const tracked = trackedByName.get(name);
              if (tracked) {
                if (tracked.language) return { kind: "skipped" };
                const meta = await readHeaders(songDir);
                if (meta === null) return { kind: "skipped" };
                return { kind: "refresh", dirName: name, meta };
              }
              return probeNewFolder(songDir, name);
            }),
          ),
        catch: (e) =>
          e instanceof Error ? e : new Error("Failed to scan archive"),
      });

      for (const r of results) {
        if (r.kind === "skipped") {
          skipped++;
        } else if (r.kind === "refresh") {
          refreshMeta.set(r.dirName, r.meta);
        } else if (r.kind === "song") {
          if (!r.hasVideo) importedWithoutVideo++;
          newEntries.push(r.entry);
        }
      }
      onProgress?.({ current: Math.min(i + SCAN_CONCURRENCY, total), total });
    }

    if (newEntries.length > 0 || refreshMeta.size > 0) {
      const updated = existing.map((e) => {
        const meta = refreshMeta.get(e.dirName);
        // Existing fields win: metadata first, then the entry layered on top
        return meta ? { ...entryMetadata(meta), ...e } : e;
      });
      yield* saveDownloadedEntries([...updated, ...newEntries]);
    }

    return {
      imported: newEntries.length,
      importedWithoutVideo,
      skipped,
      refreshed: refreshMeta.size,
    };
  });
