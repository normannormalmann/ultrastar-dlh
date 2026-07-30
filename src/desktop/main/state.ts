import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { BrowserWindow } from "electron";
import {
  type FolderLayout,
  sanitizeForPath,
} from "../../core/download/naming.ts";
import type { VideoQuality } from "../../core/api/youtube/download.ts";
import {
  checkFfmpegAvailable,
  checkYtDlpAvailable,
} from "../../core/api/youtube/check.ts";
import { ensureSession } from "../../core/session.ts";
import {
  type AppConfig,
  loadConfig,
  saveConfig,
} from "../../core/storage/config.ts";
import {
  type DownloadedEntry,
  loadDownloadedEntries,
} from "../../core/storage/downloaded.ts";
import { loadQueue, saveQueue } from "../../core/storage/queue.ts";
import type { Song } from "../../core/api/usdb/search.ts";
import type {
  ActiveDownload,
  AppStatus,
  EventChannel,
  EventPayloads,
} from "../shared/ipcContract.ts";

const QUEUE_SAVE_DEBOUNCE_MS = 2000;

export const broadcast = <C extends EventChannel>(
  channel: C,
  payload: EventPayloads[C],
): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
};

class AppState {
  cookie = "";
  config: AppConfig | null = null;
  status: AppStatus = {
    loggedIn: null,
    ytDlpAvailable: null,
    ffmpegAvailable: null,
  };
  queue: Song[] = [];
  activeDownloads: ActiveDownload[] = [];
  downloaded: DownloadedEntry[] = [];
  queueRunning = false;

  #queueSaveTimer: ReturnType<typeof setTimeout> | null = null;

  get downloadDir(): string {
    return this.config?.downloadDir ?? join(process.cwd(), "songs");
  }
  get browser(): string {
    return this.config?.browser ?? "edge";
  }
  get folderLayout(): FolderLayout {
    const v = this.config?.folderLayout;
    return v === "artist" || v === "letter" ? v : "flat";
  }
  get downloadConcurrency(): number {
    const v = this.config?.downloadConcurrency;
    return typeof v === "number" && v >= 1 && v <= 5 ? Math.floor(v) : 3;
  }
  get videoQuality(): VideoQuality {
    const v = this.config?.videoQuality;
    return v === "720" || v === "best" ? v : "1080";
  }
  get downloadedApiIds(): Set<number> {
    return new Set(this.downloaded.map((e) => e.apiId));
  }
  /**
   * Builds an "already downloaded?" predicate ONCE (apiId OR derived folder
   * name, case-insensitive because of NTFS). Hoist this out of .filter()
   * runs — the sets are only built once per call.
   */
  makeIsDownloadedSong(): (
    song: Pick<Song, "apiId" | "artist" | "title">,
  ) => boolean {
    const ids = this.downloadedApiIds;
    const dirs = new Set(this.downloaded.map((e) => e.dirName.toLowerCase()));
    return (song) =>
      ids.has(song.apiId) ||
      dirs.has(sanitizeForPath(`${song.artist} - ${song.title}`).toLowerCase());
  }

  /** Single lookup; hoist makeIsDownloadedSong() for filter runs. */
  isDownloadedSong(song: Pick<Song, "apiId" | "artist" | "title">): boolean {
    return this.makeIsDownloadedSong()(song);
  }

  setStatus(patch: Partial<AppStatus>): void {
    this.status = { ...this.status, ...patch };
    broadcast("event:status", this.status);
  }

  setQueue(next: Song[]): void {
    this.queue = next;
    broadcast("event:queueChanged", this.queue);
    // Debounced persistence like in the TUI (prevents mass writes on bulk adds)
    if (this.#queueSaveTimer) clearTimeout(this.#queueSaveTimer);
    this.#queueSaveTimer = setTimeout(() => {
      Effect.runPromise(saveQueue(this.queue)).catch((e) =>
        console.error("Failed to persist queue:", e),
      );
    }, QUEUE_SAVE_DEBOUNCE_MS);
  }

  /** Adds songs deduplicated (against queue AND history). Returns the count of new songs. */
  addToQueue(songs: Song[]): number {
    const existing = new Set(this.queue.map((s) => s.apiId));
    const isDownloaded = this.makeIsDownloadedSong();
    const fresh = songs.filter(
      (s) => !existing.has(s.apiId) && !isDownloaded(s),
    );
    if (fresh.length > 0) this.setQueue([...this.queue, ...fresh]);
    return fresh.length;
  }

  setActiveDownloads(next: ActiveDownload[]): void {
    this.activeDownloads = next;
    broadcast("event:activeDownloads", this.activeDownloads);
  }

  patchActiveDownload(apiId: number, patch: Partial<ActiveDownload>): void {
    this.setActiveDownloads(
      this.activeDownloads.map((d) =>
        d.apiId === apiId ? { ...d, ...patch } : d,
      ),
    );
  }

  removeActiveDownload(apiId: number): void {
    this.setActiveDownloads(
      this.activeDownloads.filter((d) => d.apiId !== apiId),
    );
  }

  setDownloaded(entries: DownloadedEntry[]): void {
    this.downloaded = entries;
    broadcast("event:downloadedChanged", this.downloaded);
  }

  /** Merge in a single freshly downloaded entry — without a full 28k-entry rescan. */
  upsertDownloaded(entry: DownloadedEntry): void {
    this.setDownloaded([
      entry,
      ...this.downloaded.filter((e) => e.apiId !== entry.apiId),
    ]);
  }

  setQueueRunning(running: boolean): void {
    this.queueRunning = running;
    broadcast("event:queueRunning", running);
  }

  async saveConfigAndApply(config: AppConfig): Promise<void> {
    await Effect.runPromise(saveConfig(config));
    this.config = config;
  }
}

export const state = new AppState();

const STAT_CONCURRENCY = 64;

/** Load history and filter out entries without video.mp4 for the UI (like the TUI). */
export const reloadDownloadedEntries = async (
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<void> => {
  try {
    const entries = await Effect.runPromise(loadDownloadedEntries);
    const valid: DownloadedEntry[] = [];
    for (let i = 0; i < entries.length; i += STAT_CONCURRENCY) {
      const chunk = entries.slice(i, i + STAT_CONCURRENCY);
      await Promise.all(
        chunk.map(async (e) => {
          try {
            await stat(join(e.songDir, "video.mp4"));
            valid.push(e);
          } catch {
            // File missing – entry stays in downloaded.json for the repair
            // feature, but isn't listed in the UI (same behavior as the TUI).
          }
        }),
      );
      onProgress?.({
        current: Math.min(i + STAT_CONCURRENCY, entries.length),
        total: entries.length,
      });
    }
    state.setDownloaded(valid);
  } catch (e) {
    console.error("Failed to load downloaded entries:", e);
  }
};

/** On app start: session, config, queue, history, tool checks. */
export const initializeState = async (): Promise<void> => {
  try {
    const session = await Effect.runPromise(ensureSession);
    state.cookie = session.cookie;
    state.setStatus({ loggedIn: true });
  } catch (e) {
    console.error("USDB session failed:", e);
    state.setStatus({ loggedIn: false });
  }

  state.config = await Effect.runPromise(loadConfig).catch(() => null);

  const savedQueue = await Effect.runPromise(loadQueue).catch(
    () => [] as Song[],
  );
  if (savedQueue.length > 0) state.setQueue(savedQueue);

  await reloadDownloadedEntries();

  const [yt, ff] = await Promise.all([
    Effect.runPromise(checkYtDlpAvailable),
    Effect.runPromise(checkFfmpegAvailable),
  ]);
  state.setStatus({ ytDlpAvailable: yt, ffmpegAvailable: ff });
};
