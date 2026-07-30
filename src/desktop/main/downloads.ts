import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { searchSongs, type Song } from "../../core/api/usdb/search.ts";
import { entryMetadata } from "../../core/download/importArchive.ts";
import {
  parseTxtHeaders,
  type TxtHeaders,
} from "../../core/download/repairSongs.ts";
import { downloadSong } from "../../core/download/downloadSong.ts";
import { appendDownloadedEntry } from "../../core/storage/downloaded.ts";
import { appendFailedDownload } from "../../core/storage/failedDownloads.ts";
import { broadcast, state } from "./state.ts";
import type { BulkQueueRequest } from "../shared/ipcContract.ts";

const COMPLETED_REMOVE_DELAY_MS = 1500;
const FAILED_REMOVE_DELAY_MS = 8000;
const BULK_FETCH_YIELD_MS = 10;

/**
 * Downloads a song and maintains activeDownloads/history/failure log.
 * Never throws — errors surface as status:"failed" in the UI event and log.
 */
export const downloadSongItem = async (song: Song): Promise<void> => {
  if (!state.cookie) return;
  if (
    state.status.ytDlpAvailable === false ||
    state.status.ffmpegAvailable === false
  ) {
    broadcast("event:error", {
      context: "download",
      message:
        "yt-dlp oder ffmpeg ist nicht installiert. Downloads sind deaktiviert (Einstellungen → Tools).",
    });
    return;
  }
  if (state.activeDownloads.some((d) => d.apiId === song.apiId)) return;
  if (state.isDownloadedSong(song)) return;

  state.setActiveDownloads([
    ...state.activeDownloads,
    {
      apiId: song.apiId,
      artist: song.artist,
      title: song.title,
      progress: 0,
      status: "downloading",
    },
  ]);

  try {
    const result = await Effect.runPromise(
      downloadSong({
        song,
        cookie: state.cookie,
        baseDir: state.downloadDir,
        cookiesBrowser: state.browser,
        folderLayout: state.folderLayout,
        videoQuality: state.videoQuality,
        onProgress: (p) =>
          state.patchActiveDownload(song.apiId, { progress: p }),
        onWarning: (warnings) => {
          broadcast("event:error", {
            context: "warnung",
            message: `"${song.title}": ${warnings.join(" | ")}`,
          });
        },
      }),
    );

    const headers = await readFile(join(result.songDir, "song.txt"), "utf8")
      .then((txt) => parseTxtHeaders(txt))
      .catch(() => ({}) as TxtHeaders);

    const entry = {
      apiId: song.apiId,
      artist: song.artist,
      title: song.title,
      dirName: result.dirName,
      songDir: result.songDir,
      downloadedAt: new Date().toISOString(),
      ...entryMetadata(headers),
    };
    await Effect.runPromise(appendDownloadedEntry(entry)).catch((e) => {
      broadcast("event:error", {
        context: "tracking",
        message: `Download ok, Tracking fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
      });
    });
    state.upsertDownloaded(entry);

    state.patchActiveDownload(song.apiId, { progress: 1, status: "completed" });
    setTimeout(
      () => state.removeActiveDownload(song.apiId),
      COMPLETED_REMOVE_DELAY_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Effect.runPromise(
      appendFailedDownload(state.downloadDir, song, message),
    ).catch(() => {});
    state.patchActiveDownload(song.apiId, { status: "failed", error: message });
    broadcast("event:error", {
      context: "download",
      message: `"${song.title}": ${message}`,
    });
    setTimeout(
      () => state.removeActiveDownload(song.apiId),
      FAILED_REMOVE_DELAY_MS,
    );
  }
};

let queueCancelRequested = false;

/** Stops queue processing after the currently running batch. */
export const requestQueueCancel = (): void => {
  queueCancelRequested = true;
};

/** Process the queue: batches sized by configured concurrency (settings). Cancellable. */
export const processQueue = async (): Promise<void> => {
  if (state.queueRunning || state.queue.length === 0) return;
  if (
    state.status.ytDlpAvailable === false ||
    state.status.ffmpegAvailable === false
  ) {
    broadcast("event:error", {
      context: "download",
      message:
        "yt-dlp oder ffmpeg ist nicht installiert. Downloads sind deaktiviert (Einstellungen → Tools).",
    });
    return;
  }
  state.setQueueRunning(true);
  queueCancelRequested = false;
  try {
    const concurrency = state.downloadConcurrency;
    let isDownloaded = state.makeIsDownloadedSong();
    let current = state.queue.filter((s) => !isDownloaded(s));
    while (current.length > 0 && !queueCancelRequested) {
      const batch = current.slice(0, concurrency);
      await Promise.all(batch.map((song) => downloadSongItem(song)));
      state.setQueue(
        state.queue.filter((s) => !batch.some((b) => b.apiId === s.apiId)),
      );
      isDownloaded = state.makeIsDownloadedSong();
      current = current.slice(batch.length).filter((s) => !isDownloaded(s));
    }
  } finally {
    state.setQueueRunning(false);
  }
};

let bulkFetchRunning = false;

/**
 * Load all pages of a search (or, with empty fields, the entire database)
 * into the queue page by page. totalPages is tracked dynamically.
 */
export const fetchAllIntoQueue = async (
  req: BulkQueueRequest,
): Promise<void> => {
  if (!state.cookie || bulkFetchRunning) return;
  bulkFetchRunning = true;
  try {
    const limit = 20;
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      broadcast("event:fetchAllProgress", { current: page, total: totalPages });
      const result = await Effect.runPromise(
        searchSongs(
          {
            interpret: req.artist.trim() || undefined,
            title: req.title.trim() || undefined,
            language: req.language,
            genre: req.genre,
            year: req.year,
            order: req.order,
            ud: req.ud,
            golden: req.golden,
            songcheck: req.songcheck,
            limit,
            start: (page - 1) * limit,
          },
          state.cookie,
        ),
      );
      if (result.totalPages > totalPages) totalPages = result.totalPages;
      state.addToQueue(result.songs);
      // Let the event loop breathe (memory/IPC), like the TUI
      await new Promise((r) => setTimeout(r, BULK_FETCH_YIELD_MS));
      page++;
    }
  } catch (err) {
    broadcast("event:error", {
      context: "bulk-fetch",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    bulkFetchRunning = false;
    broadcast("event:fetchAllProgress", null);
  }
};
