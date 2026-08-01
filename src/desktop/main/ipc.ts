import { Effect } from "effect";
import { app, dialog, type IpcMain, shell } from "electron";
import { searchSongs } from "../../core/api/usdb/search.ts";
import type { AppConfig } from "../../core/storage/config.ts";
import type {
  BulkQueueRequest,
  InitialState,
  InvokeChannel,
  SearchRequest,
} from "../shared/ipcContract.ts";
import { scanAndRepairVideos } from "../../core/download/repairSongs.ts";
import { importArchive } from "../../core/download/importArchive.ts";
import { enrichGenres } from "../../core/download/enrichGenres.ts";
import { deezerProvider } from "../../core/api/genres/deezer.ts";
import { makeLastfmProvider } from "../../core/api/genres/lastfm.ts";
import { musicbrainzProvider } from "../../core/api/genres/musicbrainz.ts";
import type { GenreProvider } from "../../core/api/genres/provider.ts";
import type { GenreProviderId } from "../../core/api/genres/provider.ts";
import { loadFailedDownloads } from "../../core/storage/failedDownloads.ts";
import { binariesStatus, installMissingBinaries } from "./binaries.ts";
import {
  cancelEnvironmentInstall,
  creationWorkDir,
  environmentStatusForApp,
  installEnvironmentForApp,
  managedEnvDir,
} from "./environment.ts";
import { SidecarWorker } from "../../core/create/worker.ts";
import { createCreations } from "./creations.ts";
import type { CreateJobRequest } from "../shared/ipcContract.ts";
import {
  clearCoverCaches,
  getCoverDataUrl,
  getLocalCoverDataUrl,
} from "./covers.ts";
import {
  downloadSongItem,
  fetchAllIntoQueue,
  processQueue,
  requestQueueCancel,
} from "./downloads.ts";
import { broadcast, reloadDownloadedEntries, state } from "./state.ts";
import type { Song } from "../shared/ipcContract.ts";

export const SEARCH_PAGE_SIZE = 20;

let repairRunning = false;
let archiveImportRunning = false;
let genreEnrichRunning = false;
let genreEnrichCancel = false;

/**
 * All invoke handlers. The type forces EXACTLY the channels from the
 * contract to be implemented (missing one, or having one too many, is a
 * tsc error). Handler signature: (payload) => Promise<result>.
 */
/**
 * The wired creation queue. It lives here rather than in creations.ts so
 * that module stays electron-free (and therefore testable without mocks).
 * The managed environment is handed to the worker on purpose - otherwise
 * the one-click setup from subproject 2 would stay unused.
 */
export const creations = createCreations({
  newWorker: () => new SidecarWorker({ managedEnvDir: managedEnvDir() }),
  environmentStatus: environmentStatusForApp,
  workDir: creationWorkDir,
  broadcast,
});

// biome-ignore lint/suspicious/noExplicitAny: central IPC boundary, types are per-channel in the contract
export const handlers: Record<InvokeChannel, (payload?: any) => Promise<any>> =
  {
    "app:getInitialState": async (): Promise<InitialState> => ({
      config: state.config,
      status: state.status,
      queue: state.queue,
      downloaded: state.downloaded,
      version: app.getVersion(),
    }),

    "usdb:search": async (req: SearchRequest) => {
      const start = (req.page - 1) * SEARCH_PAGE_SIZE;
      return Effect.runPromise(
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
            limit: SEARCH_PAGE_SIZE,
            start,
          },
          state.cookie,
        ),
      );
    },

    "settings:get": async () => state.config,

    "settings:save": async (config: AppConfig) => {
      await state.saveConfigAndApply(config);
    },

    "settings:chooseDirectory": async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        defaultPath: state.downloadDir,
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    "shell:openFolder": async (path: string) => {
      await shell.openPath(path);
    },

    "download:single": async (song: Song) => {
      void downloadSongItem(song);
    },

    "downloads:failedList": async () =>
      Effect.runPromise(loadFailedDownloads(state.downloadDir)),

    "library:refresh": async () => {
      try {
        await reloadDownloadedEntries((p) =>
          broadcast("event:libraryRefreshProgress", p),
        );
      } finally {
        broadcast("event:libraryRefreshProgress", null);
      }
    },

    "archive:import": async () => {
      if (archiveImportRunning) {
        return {
          imported: 0,
          importedWithoutVideo: 0,
          skipped: 0,
          refreshed: 0,
        };
      }
      if (
        state.queueRunning ||
        state.activeDownloads.length > 0 ||
        repairRunning ||
        genreEnrichRunning
      ) {
        throw new Error(
          "Import nicht möglich, während Downloads, eine Reparatur oder Genre-Anreicherung laufen. Bitte warten und erneut versuchen.",
        );
      }
      archiveImportRunning = true;
      try {
        const result = await Effect.runPromise(
          importArchive(state.downloadDir, (p) =>
            broadcast("event:archiveImportProgress", p),
          ),
        );
        await reloadDownloadedEntries((p) =>
          broadcast("event:libraryRefreshProgress", p),
        );
        return result;
      } finally {
        archiveImportRunning = false;
        broadcast("event:archiveImportProgress", null);
        broadcast("event:libraryRefreshProgress", null);
      }
    },

    "queue:add": async (songs: Song[]) => state.addToQueue(songs),

    "queue:remove": async (apiId: number) => {
      state.setQueue(state.queue.filter((s) => s.apiId !== apiId));
    },

    "queue:clear": async () => {
      state.setQueue([]);
    },

    "queue:start": async () => {
      void processQueue();
    },

    "queue:cancel": async () => {
      requestQueueCancel();
    },

    "queue:fetchAllPages": async (req: BulkQueueRequest) => {
      void fetchAllIntoQueue(req);
    },

    "queue:entireDatabase": async () => {
      void fetchAllIntoQueue({ artist: "", title: "" });
    },

    "repair:start": async () => {
      if (repairRunning) return;
      if (archiveImportRunning || genreEnrichRunning) {
        broadcast("event:error", {
          context: "repair",
          message:
            "Reparatur nicht möglich, während der Archiv-Import oder Genre-Anreicherung läuft. Bitte warten und erneut versuchen.",
        });
        return;
      }
      repairRunning = true;
      broadcast("event:repair", {
        running: true,
        progress: null,
        result: null,
      });
      void Effect.runPromise(
        scanAndRepairVideos(
          state.downloadDir,
          state.cookie,
          state.browser,
          (p) =>
            broadcast("event:repair", {
              running: true,
              progress: p,
              result: null,
            }),
          state.videoQuality,
        ),
      )
        .then(async (result) => {
          await reloadDownloadedEntries((p) =>
            broadcast("event:libraryRefreshProgress", p),
          );
          broadcast("event:libraryRefreshProgress", null);
          broadcast("event:repair", {
            running: false,
            progress: null,
            result: { ...result, errors: [...result.errors.entries()] },
          });
        })
        .catch((err) => {
          broadcast("event:error", {
            context: "repair",
            message: err instanceof Error ? err.message : String(err),
          });
          broadcast("event:repair", {
            running: false,
            progress: null,
            result: null,
          });
        })
        .finally(() => {
          repairRunning = false;
        });
    },
    "binaries:status": async () => binariesStatus(),
    "binaries:install": async (force?: boolean) => {
      await installMissingBinaries(force === true);
    },
    "environment:status": async () => environmentStatusForApp(),
    "environment:install": async (force?: boolean) =>
      installEnvironmentForApp(force === true),
    "environment:cancel": async () => {
      cancelEnvironmentInstall();
    },
    "create:queueAdd": async (jobs: CreateJobRequest[]) =>
      creations.queueAdd(jobs),
    "create:queueRemove": async (id: string) => {
      creations.queueRemove(id);
    },
    "create:queueClear": async () => {
      creations.queueClear();
    },
    "create:start": async () => {
      await creations.start();
    },
    "create:cancel": async () => {
      creations.cancel();
    },
    "covers:get": async (apiId: number) => getCoverDataUrl(apiId),
    "covers:getLocal": async (songDir: string) => getLocalCoverDataUrl(songDir),
    "covers:clearCache": async () => clearCoverCaches(),

    "genres:enrich": async () => {
      if (genreEnrichRunning) {
        throw new Error("Genre-Anreicherung läuft bereits.");
      }
      if (
        state.queueRunning ||
        state.activeDownloads.length > 0 ||
        repairRunning ||
        archiveImportRunning
      ) {
        throw new Error(
          "Anreicherung nicht möglich, während Downloads, Import oder Reparatur laufen.",
        );
      }
      const providerId = (state.config?.genreProvider ??
        "deezer") as GenreProviderId;
      let provider: GenreProvider;
      if (providerId === "lastfm") {
        const key = state.config?.lastfmApiKey?.trim();
        if (!key) {
          throw new Error(
            "Last.fm benötigt einen API-Key (Einstellungen → Genre-Quelle).",
          );
        }
        provider = makeLastfmProvider(key);
      } else if (providerId === "musicbrainz") {
        provider = musicbrainzProvider;
      } else {
        provider = deezerProvider;
      }

      genreEnrichRunning = true;
      genreEnrichCancel = false;
      try {
        const result = await Effect.runPromise(
          enrichGenres(provider.lookup, {
            minDelayMs: provider.minDelayMs,
            onProgress: (p) => broadcast("event:genreEnrichProgress", p),
            shouldCancel: () => genreEnrichCancel,
          }),
        );
        await reloadDownloadedEntries();
        return result;
      } finally {
        genreEnrichRunning = false;
        broadcast("event:genreEnrichProgress", null);
      }
    },

    "genres:cancel": async () => {
      genreEnrichCancel = true;
    },
  };

export const registerIpcHandlers = (ipcMain: IpcMain): void => {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, payload) => handler(payload));
  }
};
