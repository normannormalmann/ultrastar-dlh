import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { YoutubeLink } from "../api/usdb/youtube.ts";
import { getYoutubeLinksById } from "../api/usdb/youtube.ts";
import {
  downloadYoutubeVideoWithProgress,
  type VideoQuality,
} from "../api/youtube/download.ts";
import type { YoutubeVideo } from "../api/youtube/search.ts";
import { searchYoutubeVideos } from "../api/youtube/search.ts";
import type { DownloadedEntry } from "../storage/downloaded.ts";
import {
  appendDownloadedEntry,
  loadDownloadedEntries,
  saveDownloadedEntries,
} from "../storage/downloaded.ts";

export type RepairProgress = {
  current: number;
  total: number;
  currentSong: string;
  videoProgress?: number; // 0..1
};

export type RepairErrorType =
  | "not_found"
  | "network_error"
  | "no_video"
  | "auth_error"
  | "rate_limit"
  | "unknown";

export type RepairResult = {
  total: number;
  fixed: number;
  rebuilt: number; // songs added to tracking (already had video.mp4)
  failed: string[];
  errors: Map<string, { type: RepairErrorType; message: string }>;
};

/** Replaces a header (or inserts it after the first header line); preserves EOL style. */
export const applyHeader = (
  txt: string,
  key: string,
  value: string,
): string => {
  const line = `#${key.toUpperCase()}:${value}`;
  const pattern = new RegExp(`^#${key.toUpperCase()}:.*$`, "m");
  if (pattern.test(txt)) return txt.replace(pattern, line);
  const eol = txt.includes("\r\n") ? "\r\n" : "\n";
  return txt.replace(/^(#[^\n]*\n)/, `$1${line}${eol}`);
};

export const applyVideoGap = (txt: string, gap: string): string =>
  applyHeader(txt, "VIDEOGAP", gap);

/** Stable negative hash so songs without a USDB apiId get a unique tracking id. */
export function stableHash(s: string): number {
  let h = 0;
  for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return h < 0 ? h : ~h; // always negative, never 0
}

export type TxtHeaders = {
  artist?: string;
  title?: string;
  language?: string;
  genre?: string;
  edition?: string;
  creator?: string;
  year?: number;
  bpm?: number;
};

export function parseTxtHeaders(content: string): TxtHeaders {
  const result: TxtHeaders = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith("#")) break; // the header block is contiguous at the start of the file
    const match = /^#(\w+):(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1]?.toUpperCase();
    const value = match[2]?.trim() ?? "";
    if (value.length === 0) continue;
    switch (key) {
      case "ARTIST":
        result.artist = value;
        break;
      case "TITLE":
        result.title = value;
        break;
      case "LANGUAGE":
        result.language = value;
        break;
      case "GENRE":
        result.genre = value;
        break;
      case "EDITION":
        result.edition = value;
        break;
      case "CREATOR":
        result.creator = value;
        break;
      case "YEAR": {
        const y = Number.parseInt(value, 10);
        if (!Number.isNaN(y)) result.year = y;
        break;
      }
      case "BPM": {
        // German files use a comma as decimal separator ("294,5")
        const b = Number.parseFloat(value.replace(",", "."));
        if (!Number.isNaN(b)) result.bpm = b;
        break;
      }
      default:
        break;
    }
  }
  return result;
}

const repairSingleSong = (
  songDir: string,
  dirName: string,
  cookie: string,
  apiId: number | null,
  cookiesBrowser?: string,
  onProgress?: (p: number) => void,
  videoQuality?: VideoQuality,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    // Read artist/title from song.txt for fallback search
    const txtContent = yield* Effect.catchAll(
      Effect.tryPromise({
        try: async () => readFile(join(songDir, "song.txt"), "utf8"),
        catch: (e) => (e instanceof Error ? e : new Error("read failed")),
      }),
      () => Effect.succeed(""),
    );
    const { artist, title } = parseTxtHeaders(txtContent);

    // Step 1: Try USDB API if we have an apiId
    let videoLink: string | null = null;
    let videoGap: string | undefined;
    if (apiId !== null && apiId > 0) {
      const links = yield* Effect.catchAll(
        getYoutubeLinksById(apiId, cookie),
        () => Effect.succeed<YoutubeLink[]>([]),
      );
      if (links.length > 0) {
        videoLink = links[0]?.link ?? null;
      }
      videoGap = links[0]?.videoGap;
    }

    // Step 2: Fall back to YouTube search
    if (!videoLink) {
      if (!artist && !title) return false;
      const query = [artist, title].filter(Boolean).join(" ");
      const results = yield* Effect.catchAll(searchYoutubeVideos(query), () =>
        Effect.succeed<YoutubeVideo[]>([]),
      );
      const first = results[0];
      if (!first) return false;
      videoLink = first.url || `https://youtu.be/${first.id}`;
    }

    // Validate videoLink before normalization
    if (!videoLink) {
      return yield* Effect.fail(new Error("No video link found"));
    }

    // Normalize link (same logic as downloadSong.ts)
    const normalizedLink = /^(https?:)?\/\//.test(videoLink)
      ? videoLink
      : `https://youtu.be/${videoLink}`;

    const videoPath = join(songDir, "video.mp4");
    yield* downloadYoutubeVideoWithProgress(
      normalizedLink,
      videoPath,
      (p) => onProgress?.(p.percent ?? 0),
      cookiesBrowser,
      videoQuality,
    );

    // Verify file was written
    const fileOk = yield* Effect.tryPromise({
      try: async () => {
        const s = await stat(videoPath);
        return s.size > 0;
      },
      catch: (e) => (e instanceof Error ? e : new Error("verify failed")),
    }).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!fileOk) return false;

    // Apply videoGap from USDB comment (best-effort, does not fail repair)
    if (videoGap) {
      yield* Effect.tryPromise({
        try: async () => {
          const txtPath = join(songDir, "song.txt");
          const txt = await readFile(txtPath, "utf8");
          await writeFile(txtPath, applyVideoGap(txt, videoGap), "utf8");
        },
        catch: (e) =>
          e instanceof Error ? e : new Error("videogap patch failed"),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    // Update tracking – always track, use stable hash when no USDB apiId
    const trackingApiId =
      apiId !== null && apiId > 0 ? apiId : stableHash(dirName);
    yield* Effect.catchAll(
      appendDownloadedEntry({
        apiId: trackingApiId,
        artist: artist ?? dirName,
        title: title ?? dirName,
        dirName,
        songDir,
        downloadedAt: new Date().toISOString(),
      }),
      () => Effect.succeed([]),
    );

    return true;
  });

export const scanAndRepairVideos = (
  downloadDir: string,
  cookie: string,
  cookiesBrowser?: string,
  onProgress?: (p: RepairProgress) => void,
  videoQuality?: VideoQuality,
): Effect.Effect<RepairResult, Error> =>
  Effect.gen(function* () {
    const folders = yield* Effect.tryPromise({
      try: async () => {
        const dirents = await readdir(downloadDir, { withFileTypes: true });
        return dirents.filter((d) => d.isDirectory()).map((d) => d.name);
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to read directory"),
    });

    // Load downloaded.json to retrieve apiIds for broken entries
    const allEntries = yield* loadDownloadedEntries;
    const entryByDirName = new Map(allEntries.map((e) => [e.dirName, e]));

    // Partition: needs repair vs already has video
    const needsRepair: string[] = [];
    const hasVideo: string[] = [];
    for (const name of folders) {
      const videoPath = join(downloadDir, name, "video.mp4");
      const missing = yield* Effect.tryPromise({
        try: async () => {
          try {
            const s = await stat(videoPath);
            return s.size <= 1024 * 1024;
          } catch {
            return true;
          }
        },
        catch: (e) => (e instanceof Error ? e : new Error("stat failed")),
      });
      if (missing) needsRepair.push(name);
      else hasVideo.push(name);
    }

    // ── Rebuild tracking for untracked songs that already have video.mp4 ──
    const untrackedWithVideo = hasVideo.filter(
      (name) => !entryByDirName.has(name),
    );
    let rebuilt = 0;
    if (untrackedWithVideo.length > 0) {
      const newEntries: DownloadedEntry[] = [];
      for (const name of untrackedWithVideo) {
        const songDir = join(downloadDir, name);
        const txtContent = yield* Effect.catchAll(
          Effect.tryPromise({
            try: async () => readFile(join(songDir, "song.txt"), "utf8"),
            catch: () => "" as string,
          }),
          () => Effect.succeed(""),
        );
        const { artist, title } = parseTxtHeaders(txtContent);
        if (!artist && !title) continue;
        newEntries.push({
          apiId: stableHash(name),
          artist: artist ?? name,
          title: title ?? name,
          dirName: name,
          songDir,
          downloadedAt: new Date().toISOString(),
        });
      }
      if (newEntries.length > 0) {
        yield* Effect.catchAll(
          Effect.gen(function* () {
            const existing = yield* loadDownloadedEntries;
            const filtered = existing.filter(
              (e) => !newEntries.some((n) => n.dirName === e.dirName),
            );
            yield* saveDownloadedEntries([...newEntries, ...filtered]);
          }),
          () => Effect.succeed(undefined),
        );
        rebuilt = newEntries.length;
      }
    }

    // ── Repair missing videos in parallel (concurrency = 3) ──
    const total = needsRepair.length;

    // Atomic counter to avoid race conditions with parallel repairs
    let completedCount = 0;
    const updateProgress = (songName: string, videoProgress?: number) => {
      // Use completedCount instead of array index to ensure accurate progress
      onProgress?.({
        current: completedCount + 1,
        total,
        currentSong: songName,
        videoProgress,
      });
    };

    // Helper function to categorize errors
    const categorizeError = (
      error: Error,
    ): { type: RepairErrorType; message: string } => {
      const message = error.message.toLowerCase();

      // Check for specific error patterns
      if (
        message.includes("network") ||
        message.includes("etimedout") ||
        message.includes("enotfound")
      ) {
        return { type: "network_error", message: error.message };
      }
      if (
        message.includes("401") ||
        message.includes("unauthorized") ||
        message.includes("forbidden")
      ) {
        return { type: "auth_error", message: error.message };
      }
      if (
        message.includes("429") ||
        message.includes("rate limit") ||
        message.includes("too many requests")
      ) {
        return { type: "rate_limit", message: error.message };
      }
      if (
        message.includes("no video") ||
        message.includes("video not available") ||
        message.includes("not found")
      ) {
        return { type: "no_video", message: error.message };
      }
      if (message.includes("not found")) {
        return { type: "not_found", message: error.message };
      }

      return { type: "unknown", message: error.message };
    };

    const repairEffects = needsRepair.map((name, idx) =>
      Effect.gen(function* () {
        const songDir = join(downloadDir, name);
        // Update progress when starting
        updateProgress(name);

        const apiId = entryByDirName.get(name)?.apiId ?? null;

        // Attempt repair with error categorization
        const result = yield* Effect.catchAll(
          repairSingleSong(
            songDir,
            name,
            cookie,
            apiId,
            cookiesBrowser,
            (videoProgress) => {
              // Update with video progress
              onProgress?.({
                current: completedCount + 1,
                total,
                currentSong: name,
                videoProgress,
              });
            },
            videoQuality,
          ),
          (error) => {
            // Categorize the error for better user feedback
            const categorized = categorizeError(
              error instanceof Error ? error : new Error(String(error)),
            );
            return Effect.succeed<{
              success: boolean;
              error?: { type: RepairErrorType; message: string };
            }>({
              success: false,
              error: categorized,
            });
          },
        );

        const success = typeof result === "boolean" ? result : result.success;

        // Increment completed count only when actually finished
        if (success) {
          completedCount++;
        }

        return {
          success,
          idx,
          error:
            typeof result === "object" && "error" in result
              ? result.error
              : undefined,
        };
      }),
    );

    const results = yield* Effect.all(repairEffects, { concurrency: 3 });
    let fixed = 0;
    const failed: string[] = [];
    const errors = new Map<
      string,
      { type: RepairErrorType; message: string }
    >();

    for (const result of results) {
      const songName = needsRepair[result.idx] ?? `unknown-${result.idx}`;
      if (result.success) {
        fixed++;
      } else {
        failed.push(songName);
        if (result.error) {
          errors.set(songName, result.error);
        }
      }
    }

    return { total, fixed, rebuilt, failed, errors };
  });
