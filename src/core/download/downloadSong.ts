import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { type FolderLayout, songRelativePath } from "./naming.ts";
import { downloadCoverById } from "../api/usdb/cover.ts";
import { getLyricsById } from "../api/usdb/lyrics.ts";
import type { Song } from "../api/usdb/search.ts";
import type { YoutubeLink } from "../api/usdb/youtube.ts";
import { getYoutubeLinksById } from "../api/usdb/youtube.ts";
import {
  type VideoQuality,
  downloadYoutubeVideoWithProgress,
} from "../api/youtube/download.ts";
import type { YoutubeVideo } from "../api/youtube/search.ts";
import { searchYoutubeVideos } from "../api/youtube/search.ts";

export type DownloadSongParams = {
  song: Song;
  cookie: string;
  baseDir?: string; // defaults to CWD/songs
  cookiesBrowser?: string; // e.g. "edge", "chrome", "firefox"
  onProgress?: (p: number) => void; // 0..1
  onWarning?: (warnings: string[]) => void; // For optional failures (e.g., cover)
  folderLayout?: FolderLayout;
  videoQuality?: VideoQuality;
};

export type DownloadSongResult = {
  dirName: string;
  songDir: string;
};

export const downloadSong = (
  params: DownloadSongParams,
): Effect.Effect<DownloadSongResult, Error> =>
  Effect.gen(function* () {
    const { song, cookie, onProgress, onWarning } = params;
    const baseDir = params.baseDir ?? join(process.cwd(), "songs");

    const relPath = songRelativePath(
      song.artist,
      song.title,
      params.folderLayout ?? "flat",
    );
    const dirName = relPath.split("/").pop() as string;
    const songDir = join(baseDir, relPath);

    // ensure directories
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(baseDir, { recursive: true });
        await mkdir(songDir, { recursive: true });
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to create directories"),
    });

    // Resolve YouTube link first
    let videoLink: string | null = null;
    const links = yield* Effect.catchAll(
      getYoutubeLinksById(song.apiId, cookie),
      () => Effect.succeed<YoutubeLink[]>([]),
    );
    if (links.length > 0) {
      videoLink = links[0]?.link ?? null;
    }
    const videoGapOverride = links[0]?.videoGap;
    if (!videoLink) {
      const results = yield* Effect.catchAll(
        searchYoutubeVideos(`${song.artist} ${song.title}`),
        () => Effect.succeed<YoutubeVideo[]>([]),
      );
      const first = results[0];
      if (first) videoLink = first.url || first.id;
    }
    if (!videoLink) {
      return yield* Effect.fail(
        new Error("No YouTube links found for this song"),
      );
    }
    const normalizedLink = /^(https?:)?\/\//.test(videoLink)
      ? videoLink
      : `https://youtu.be/${videoLink}`;

    // Parallel: cover (optional), lyrics (critical), and video (critical) download
    // Progress weighting for Karaoke:
    // - Cover: 5% (optional - nice to have)
    // - Lyrics: 15% (CRITICAL for UltraStar)
    // - Video: 80% (CRITICAL for UltraStar)

    let coverProgress = 0;
    let lyricsProgress = 0;
    let videoProgress = 0;
    const warnings: string[] = []; // Collect warnings for optional failures

    const updateOverallProgress = () => {
      // Weighted progress calculation
      const overall =
        coverProgress * 0.05 + lyricsProgress * 0.15 + videoProgress * 0.8;
      onProgress?.(overall);
    };

    const coverEff = Effect.gen(function* () {
      const coverBytes = yield* Effect.catchAll(
        downloadCoverById(song.apiId, cookie),
        () => Effect.succeed<Uint8Array | null>(null),
      );
      if (coverBytes) {
        yield* Effect.tryPromise({
          try: async () => {
            await writeFile(join(songDir, "cover.jpg"), coverBytes);
            coverProgress = 1;
            updateOverallProgress();
          },
          catch: (e) =>
            e instanceof Error ? e : new Error("Failed to write cover"),
        });
      } else {
        // Cover failed, but it's optional - just add a warning
        warnings.push(`Cover could not be downloaded for "${song.title}"`);
        coverProgress = 1;
        updateOverallProgress();
      }
    });

    const lyricsEff = Effect.gen(function* () {
      const parsed = yield* Effect.catchAll(
        getLyricsById(song.apiId, cookie),
        () => Effect.succeed(null),
      );

      // Lyrics are CRITICAL for Karaoke - fail if not available
      if (!parsed) {
        return yield* Effect.fail(
          new Error(
            `Lyrics not found for "${song.title}" by ${song.artist}. Lyrics are REQUIRED for UltraStar.`,
          ),
        );
      }

      const headers = {
        ...parsed.headers,
        ...(videoGapOverride ? { videogap: videoGapOverride } : {}),
        mp3: "video.mp4",
        video: "video.mp4",
        cover: "cover.jpg",
      } as Record<string, string | undefined>;
      const headerLines = Object.entries(headers)
        .filter(([, v]) => v != null && String(v).trim().length > 0)
        .map(([k, v]) => `#${k.toUpperCase()}:${v}`)
        .join("\n");
      const content = `${headerLines}\n${parsed.lyrics.trim()}\n`;
      yield* Effect.tryPromise({
        try: async () => {
          await writeFile(join(songDir, "song.txt"), content);
          lyricsProgress = 1;
          updateOverallProgress();
        },
        catch: (e) =>
          new Error(
            `Failed to write lyrics for "${song.title}": ${e instanceof Error ? e.message : String(e)}`,
          ),
      });
    });

    const videoPath = join(songDir, "video.mp4");

    const videoEff = Effect.gen(function* () {
      // Skip if already downloaded (file exists and is > 1 MB)
      const alreadyDone = yield* Effect.tryPromise({
        try: async () => {
          const s = await stat(videoPath);
          return s.size > 1024 * 1024;
        },
        catch: () => false as boolean,
      }).pipe(Effect.catchAll(() => Effect.succeed(false)));

      if (alreadyDone) {
        // Video exists, but cover/lyrics might still be downloading
        // We'll update to 100% after cover/lyrics complete
        videoProgress = 1;
        updateOverallProgress();
        return;
      }

      yield* downloadYoutubeVideoWithProgress(
        normalizedLink,
        videoPath,
        (p) => {
          // Update video progress (0-1) and trigger overall progress update
          videoProgress = p.percent ?? 0;
          updateOverallProgress();
        },
        params.cookiesBrowser,
        params.videoQuality,
      );

      // Verify file was actually written
      yield* Effect.tryPromise({
        try: async () => {
          const s = await stat(videoPath);
          if (s.size === 0)
            throw new Error("video.mp4 is empty after download");
        },
        catch: (e) =>
          e instanceof Error
            ? e
            : new Error("video.mp4 missing after download"),
      });
    });

    // run in parallel
    yield* Effect.all([coverEff, lyricsEff, videoEff], { concurrency: 3 });

    // Call warning callback if there were any optional failures (e.g., cover)
    if (warnings.length > 0 && onWarning) {
      onWarning(warnings);
    }

    return { dirName, songDir } as DownloadSongResult;
  });
