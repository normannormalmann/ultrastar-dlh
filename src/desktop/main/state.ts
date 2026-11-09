import { join, relative, resolve, isAbsolute } from "node:path";
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

export const eventState: Partial<EventPayloads> = {};

const QUEUE_SAVE_DEBOUNCE_MS = 2000;

export const broadcast = <C extends EventChannel>(
  channel: C,
  payload: EventPayloads[C],
): void => {
  Object.assign(eventState, { [channel]: payload });
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

  async flushQueue(): Promise<void> {
    if (this.#queueSaveTimer) clearTimeout(this.#queueSaveTimer);
    this.#queueSaveTimer = null;
    await Effect.runPromise(saveQueue(this.queue));
  }

  /** Adds songs deduplicated (against queue AND history). Returns the count of new songs. */
  addToQueue(songs: Song[]): number {
    const existing = new Set(this.queue.map((s) => s.apiId));
    const isDownloaded = this.makeIsDownloadedSong();
    const fresh = songs.filter((s) => {
      if (existing.has(s.apiId) || isDownloaded(s)) return false;
      existing.add(s.apiId);
      return true;
    });
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
    this.config = await Effect.runPromise(saveConfig(config));
    broadcast("event:config", this.config);
  }
}

export const state = new AppState();

/** Keep broken entries visible so the library validator can explain them. */
export const reloadDownloadedEntries = async (
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<void> => {
  const entries = await Effect.runPromise(loadDownloadedEntries);
  const visible = entries.filter((entry) => {
    const rel = relative(resolve(state.downloadDir), resolve(entry.songDir));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
  state.setDownloaded(visible);
  onProgress?.({ current: entries.length, total: entries.length });
};

/**
 * Before the first window: the renderer takes the UI language from
 * app:getInitialState the moment it mounts. Loaded inside initializeState,
 * after the USDB login, the config was still null by then and the app came
 * up in the system language instead of the configured one.
 */
export const loadStartConfig = async (): Promise<void> => {
  state.config = await Effect.runPromise(loadConfig).catch(() => null);
};

/** On app start: session, queue, history, tool checks (config: loadStartConfig). */
export const initializeState = async (): Promise<void> => {
  const login = (async () => {
    try {
      if (process.env.ULTRASTAR_OFFLINE === "1") {
        state.setStatus({ loggedIn: false });
        return;
      }
      const session = await Effect.runPromise(
        Effect.timeout(ensureSession, "30 seconds"),
      );
      state.cookie = session.cookie;
      state.setStatus({ loggedIn: true });
    } catch (e) {
      console.error("USDB session failed:", e);
      state.setStatus({ loggedIn: false });
    }
  })();

  const savedQueue = await Effect.runPromise(loadQueue).catch(
    () => [] as Song[],
  );
  if (savedQueue.length > 0) state.setQueue(savedQueue);

  await reloadDownloadedEntries().catch((error) =>
    broadcast("event:error", { context: "library", message: String(error) }),
  );

  const [yt, ff] = await Promise.all([
    Effect.runPromise(checkYtDlpAvailable),
    Effect.runPromise(checkFfmpegAvailable),
  ]);
  state.setStatus({ ytDlpAvailable: yt, ffmpegAvailable: ff });
  await login;
};
