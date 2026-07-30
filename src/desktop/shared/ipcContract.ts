import type { Page, Song, SearchOrder } from "../../core/api/usdb/search.ts";
import type {
  RepairErrorType,
  RepairProgress,
} from "../../core/download/repairSongs.ts";
import type {
  ImportResult as ArchiveImportResult,
  ImportProgress as ArchiveImportProgress,
} from "../../core/download/importArchive.ts";
import type { EnrichResult as GenreEnrichResult } from "../../core/download/enrichGenres.ts";
import type { GenreProviderId } from "../../core/api/genres/provider.ts";
import type { AppConfig } from "../../core/storage/config.ts";
import type { DownloadedEntry } from "../../core/storage/downloaded.ts";
import type { FailedDownload } from "../../core/storage/failedDownloads.ts";

export type {
  ArchiveImportResult,
  ArchiveImportProgress,
  AppConfig,
  DownloadedEntry,
  FailedDownload,
  Page,
  Song,
  SearchOrder,
};
export type { GenreEnrichResult, GenreProviderId };

export type SearchRequest = {
  artist: string;
  title: string;
  page: number;
  language?: string;
  genre?: string;
  year?: number;
  order?: SearchOrder;
  ud?: "asc" | "desc";
  golden?: boolean;
  songcheck?: boolean;
};

export type BulkQueueRequest = Omit<SearchRequest, "page">;

export type DownloadStatus = "downloading" | "completed" | "failed";

export type ActiveDownload = {
  apiId: number;
  artist: string;
  title: string;
  progress: number; // 0..1
  status: DownloadStatus;
  error?: string;
};

export type AppStatus = {
  loggedIn: boolean | null; // null = checking
  ytDlpAvailable: boolean | null;
  ffmpegAvailable: boolean | null;
};

export type InitialState = {
  config: AppConfig | null;
  status: AppStatus;
  queue: Song[];
  downloaded: DownloadedEntry[];
  version: string;
};

export type BinarySource = "system" | "managed" | "missing";
export type BinariesStatus = { ytDlp: BinarySource; ffmpeg: BinarySource };
export type BinariesProgress = {
  name: "yt-dlp" | "ffmpeg";
  percent: number; // 0..1
} | null;

export type FetchAllProgress = { current: number; total: number } | null;

/** RepairResult with an IPC-friendly errors field (Map → Array). */
export type RepairResultWire = {
  total: number;
  fixed: number;
  rebuilt: number;
  failed: string[];
  errors: Array<[string, { type: RepairErrorType; message: string }]>;
};

export type RepairState = {
  running: boolean;
  progress: RepairProgress | null;
  result: RepairResultWire | null;
};

export type AppError = { context: string; message: string };

/** Renderer → main (ipcRenderer.invoke). */
export const INVOKE_CHANNELS = [
  "app:getInitialState",
  "usdb:search",
  "download:single",
  "downloads:failedList",
  "archive:import",
  "library:refresh",
  "queue:add",
  "queue:remove",
  "queue:clear",
  "queue:start",
  "queue:cancel",
  "queue:fetchAllPages",
  "queue:entireDatabase",
  "repair:start",
  "settings:get",
  "settings:save",
  "settings:chooseDirectory",
  "binaries:status",
  "binaries:install",
  "covers:get",
  "covers:getLocal",
  "covers:clearCache",
  "shell:openFolder",
  "genres:enrich",
  "genres:cancel",
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** Main → renderer (webContents.send). */
export const EVENT_CHANNELS = [
  "event:status",
  "event:queueChanged",
  "event:activeDownloads",
  "event:downloadedChanged",
  "event:fetchAllProgress",
  "event:archiveImportProgress",
  "event:libraryRefreshProgress",
  "event:queueRunning",
  "event:repair",
  "event:binariesProgress",
  "event:binariesStatus",
  "event:error",
  "event:genreEnrichProgress",
] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

/** Payload types per event channel. */
export type EventPayloads = {
  "event:status": AppStatus;
  "event:queueChanged": Song[];
  "event:activeDownloads": ActiveDownload[];
  "event:downloadedChanged": DownloadedEntry[];
  "event:fetchAllProgress": FetchAllProgress;
  "event:archiveImportProgress": ArchiveImportProgress | null;
  "event:libraryRefreshProgress": { current: number; total: number } | null;
  "event:queueRunning": boolean;
  "event:repair": RepairState;
  "event:binariesProgress": BinariesProgress;
  "event:binariesStatus": BinariesStatus;
  "event:error": AppError;
  "event:genreEnrichProgress": {
    current: number;
    total: number;
    enriched: number;
  } | null;
};

/** Exposed by preload in the renderer as window.ultrastar. */
export type UltrastarApi = {
  getInitialState: () => Promise<InitialState>;
  search: (req: SearchRequest) => Promise<Page>;
  downloadSingle: (song: Song) => Promise<void>;
  failedList: () => Promise<FailedDownload[]>;
  archiveImport: () => Promise<ArchiveImportResult>;
  libraryRefresh: () => Promise<void>;
  queueAdd: (songs: Song[]) => Promise<number>;
  queueRemove: (apiId: number) => Promise<void>;
  queueClear: () => Promise<void>;
  queueStart: () => Promise<void>;
  queueCancel: () => Promise<void>; // stops after the current batch
  queueFetchAllPages: (req: BulkQueueRequest) => Promise<void>;
  queueEntireDatabase: () => Promise<void>;
  repairStart: () => Promise<void>;
  settingsGet: () => Promise<AppConfig | null>;
  settingsSave: (config: AppConfig) => Promise<void>;
  chooseDirectory: () => Promise<string | null>;
  binariesStatus: () => Promise<BinariesStatus>;
  /** force=true also re-downloads app-managed binaries (the update feature). */
  binariesInstall: (force?: boolean) => Promise<void>;
  coverGet: (apiId: number) => Promise<string | null>; // data URL or null
  coverGetLocal: (songDir: string) => Promise<string | null>;
  coversClearCache: () => Promise<{ deletedFiles: number }>;
  openFolder: (path: string) => Promise<void>;
  genresEnrich: () => Promise<GenreEnrichResult>;
  genresCancel: () => Promise<void>;
  on: <C extends EventChannel>(
    channel: C,
    listener: (payload: EventPayloads[C]) => void,
  ) => () => void; // returns unsubscribe
};
