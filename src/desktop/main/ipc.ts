import { validateIpcPayload } from "../shared/validateIpc.ts";
import {
  analyzeForEditor,
  cancelVocalAnalysis,
  vocalAnalysisRunning,
} from "./vocalAnalysis.ts";
import { pathToFileURL } from "node:url";
import { resolveYoutubePreview } from "../../core/api/youtube/preview.ts";
import { getYoutubeLinksById } from "../../core/api/usdb/youtube.ts";
import { videoIdAusLink } from "../../core/create/media.ts";
import {
  inspectLibrary,
  safeSongFile,
  pathKey,
} from "../../core/library/inspect.ts";
import {
  checkUsdbSong,
  applyUsdbCandidate,
  type UsdbCandidate,
} from "../../core/library/usdbUpdates.ts";
import {
  appendDownloadedEntry,
  loadDownloadedEntries,
} from "../../core/storage/downloaded.ts";
import { stableHash } from "../../core/download/repairSongs.ts";
import { Effect } from "effect";
import { app, dialog, type IpcMain, shell } from "electron";
import { searchSongs } from "../../core/api/usdb/search.ts";
import { searchYoutubeVideos } from "../../core/api/youtube/search.ts";
import { dauerSekunden } from "../../core/create/probe.ts";
import { fetchSyncedLyrics } from "../../core/create/lrclib.ts";
import type { AppConfig } from "../../core/storage/config.ts";
import type {
  BulkQueueRequest,
  InitialState,
  InvokeChannel,
  EventChannel,
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
import {
  loadCreateQueue,
  saveCreateQueue,
} from "../../core/storage/createQueue.ts";
import { binariesStatus, installMissingBinaries } from "./binaries.ts";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
  stat,
  realpath,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cancelEnvironmentInstall,
  creationCoverDir,
  creationJobDir,
  creationWorkDir,
  environmentStatusForApp,
  installEnvironmentForApp,
  managedEnvDir,
} from "./environment.ts";
import { SidecarWorker } from "../../core/create/worker.ts";
import { acquireMedia } from "../../core/create/media.ts";
import { assemblePackage } from "../../core/create/packageSong.ts";
import { parseSongData } from "../../core/create/songData.ts";
import { createCreations } from "./creations.ts";
import {
  type CoverKandidat,
  holeCoverKandidatenIn,
  type KandidatenAnfrage,
  raeumeWaisenIn,
} from "./coverCandidates.ts";
import type {
  CoverSuche,
  CreateJobRequest,
  LyricsSuche,
  MediaQuelle,
  YoutubeVideo,
} from "../shared/ipcContract.ts";
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
import {
  broadcast,
  reloadDownloadedEntries,
  state,
  eventState,
} from "./state.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
} from "./updater.ts";
import type { EditorSaveRequest, Song } from "../shared/ipcContract.ts";
import { CodedError } from "../shared/appErrors.ts";
import { loadForEditor, saveFromEditor, realSongDir } from "./editor.ts";

export const SEARCH_PAGE_SIZE = 20;

const selectedFiles = new Set<string>();
const usdbCandidates = new Map<string, UsdbCandidate>();
let previewPending: Promise<string> | null = null;

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
 * The jobId-keyed cover-cache wrappers. They live here for the same reason
 * the creation queue does: only this module may ask electron where userData
 * is, so coverCandidates.ts stays testable without an app mock.
 */
export const holeCoverKandidaten = (
  jobId: string,
  a: KandidatenAnfrage,
): Promise<CoverKandidat[]> => {
  if (a.thumbnailUrl) {
    const url = new URL(a.thumbnailUrl);
    if (
      url.protocol !== "https:" ||
      !["i.ytimg.com", "img.youtube.com"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("Unsupported thumbnail host");
  }
  return holeCoverKandidatenIn(creationCoverDir(jobId), a);
};

const raeumeCoverJob = (jobId: string): Promise<void> =>
  rm(creationCoverDir(jobId), { recursive: true, force: true });

/** Candidates fetched for a draft that was never queued. */
export const raeumeCoverWaisen = (bekannteIds: string[]): Promise<void> =>
  // creationCoverDir validates the id; its parent is the cache root.
  raeumeWaisenIn(dirname(creationCoverDir("waise")), bekannteIds);

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
  jobDir: creationJobDir,
  libraryDir: () => state.downloadDir,
  layout: () => state.folderLayout,
  acquire: (job, jobDir, onProgress, signal) =>
    Effect.runPromise(
      acquireMedia({
        quelle: job.quelle,
        jobDir,
        onProgress,
        signal,
        cookiesBrowser: state.browser,
        videoQuality: state.videoQuality,
      }),
    ),
  schreibeJobDateien: async (job, jobDir) => {
    await mkdir(jobDir, { recursive: true });
    const lyricsPath = join(jobDir, "lyrics.txt");
    await writeFile(lyricsPath, `${job.lyricsText.trimEnd()}\n`, "utf8");
    if (job.syncedLyricsText === undefined) return { lyricsPath };
    const syncedLyricsPath = join(jobDir, "synced.lrc");
    await writeFile(syncedLyricsPath, job.syncedLyricsText, "utf8");
    return { lyricsPath, syncedLyricsPath };
  },
  aufraeumen: (jobDir) => rm(jobDir, { recursive: true, force: true }),
  raeumeCover: raeumeCoverJob,
  ladeQueue: () => Effect.runPromise(loadCreateQueue),
  speichereQueue: (jobs) => Effect.runPromise(saveCreateQueue(jobs)),
  assemble: async (job, medien, jobDir) => {
    const roh = await readFile(join(jobDir, "song_data.json"), "utf8");
    const songData = parseSongData(JSON.parse(roh));
    const paket = await Effect.runPromise(
      assemblePackage({
        songData,
        medien,
        meta: {
          artist: job.artist,
          title: job.title,
          genre: job.genre,
          year: job.year,
        },
        libraryDir: state.downloadDir,
        layout: state.folderLayout,
        jobDir,
        coverWahl: job.coverWahl,
      }),
    );
    const entry = {
      apiId: stableHash(pathKey(paket.songDir)),
      artist: job.artist,
      title: job.title,
      songDir: paket.songDir,
      dirName: paket.dirName,
      downloadedAt: new Date().toISOString(),
      language: songData.language,
      genre: job.genre,
      year: job.year,
      bpm: songData.bpm,
    };
    await Effect.runPromise(appendDownloadedEntry(entry)).catch((error) => {
      broadcast("event:error", {
        context: "tracking",
        message: `Song erstellt, aber Bibliothekseintrag nicht gespeichert: ${String(error)}`,
      });
    });
    state.upsertDownloaded(entry);
    return { ...paket, lowConfidence: songData.meta.lowConfidence };
  },
  broadcast,
});

// biome-ignore lint/suspicious/noExplicitAny: central IPC boundary, types are per-channel in the contract
export const handlers: Record<InvokeChannel, (payload?: any) => Promise<any>> =
  {
    "editor:analyze": async (request: {
      songDir: string;
      midiOffset: 48 | 60;
    }) => {
      return analyzeForEditor(
        state.downloadDir,
        request.songDir,
        request.midiOffset,
        () => creations.releaseIdleWorker(),
      );
    },
    "editor:cancelAnalysis": async (folder: string) =>
      cancelVocalAnalysis(folder),
    "app:getEventState": async (channel: EventChannel) =>
      ({
        ...eventState,
        "event:config": state.config,
        "event:status": state.status,
        "event:queueChanged": state.queue,
        "event:queueRunning": state.queueRunning,
        "event:activeDownloads": state.activeDownloads,
        "event:downloadedChanged": state.downloaded,
      })[channel],
    "library:inspect": async () =>
      Effect.runPromise(
        inspectLibrary(
          state.downloadDir,
          (await Effect.runPromise(loadDownloadedEntries)).map(
            (entry) => entry.songDir,
          ),
        ),
      ),
    "search:preview": async (song: Song) => {
      if (previewPending)
        throw new Error("Eine Vorschau wird bereits geladen.");
      const resolve = async () => {
        const links = await Effect.runPromise(
          getYoutubeLinksById(song.apiId, state.cookie),
        );
        const link = links[0]?.link;
        let id = link
          ? (videoIdAusLink(link) ?? (/^[\w-]{11}$/.test(link) ? link : null))
          : null;
        if (!id)
          id =
            (
              await Effect.runPromise(
                searchYoutubeVideos(`${song.artist} ${song.title}`),
              )
            )[0]?.id ?? null;
        if (!id) throw new Error("Keine YouTube-Vorschau gefunden.");
        return Effect.runPromise(resolveYoutubePreview(id));
      };
      previewPending = resolve();
      try {
        return await previewPending;
      } finally {
        previewPending = null;
      }
    },
    "library:usdbCheck": async (songDir: string) => {
      if (!state.cookie) throw new Error("Bitte zuerst bei USDB anmelden.");
      const entry = state.downloaded.find(
        (e) => pathKey(e.songDir) === pathKey(songDir),
      );
      const folder = await realSongDir(state.downloadDir, songDir);
      if (
        !entry ||
        entry.apiId <= 0 ||
        !folder ||
        !(await safeSongFile(folder, "song.txt"))
      )
        throw new Error("Kein bekannter USDB-Song.");
      const result = await Effect.runPromise(
        checkUsdbSong(folder, entry.apiId, state.cookie),
      );
      if (result.changed !== false)
        usdbCandidates.set(folder, result.candidate);
      else usdbCandidates.delete(folder);
      return {
        songDir,
        artist: entry.artist,
        title: entry.title,
        status:
          result.changed === null
            ? "unknown"
            : result.changed
              ? "available"
              : "current",
        localRevision: result.candidate.localRevision,
        remoteRevision: result.candidate.remoteRevision,
        localChanged: result.localChanged,
        conflict: result.conflict,
        localText: result.changed === false ? undefined : result.localText,
        baseText: result.changed === false ? undefined : result.baseText,
        proposedText:
          result.changed === false ? undefined : result.candidate.text,
      };
    },
    "library:usdbApply": async (request: {
      songDir: string;
      localRevision: string;
      remoteRevision: string;
      keepLocal?: boolean;
    }) => {
      const folder = await realSongDir(state.downloadDir, request.songDir);
      const candidate = folder ? usdbCandidates.get(folder) : null;
      if (
        !folder ||
        !candidate ||
        candidate.localRevision !== request.localRevision ||
        candidate.remoteRevision !== request.remoteRevision ||
        !(await safeSongFile(folder, "song.txt"))
      )
        throw new Error("Bitte zuerst die aktuelle USDB-Fassung prüfen.");
      await Effect.runPromise(
        applyUsdbCandidate(folder, candidate, request.keepLocal),
      );
      usdbCandidates.delete(folder);
    },
    "app:getInitialState": async (): Promise<InitialState> => ({
      config: state.config,
      status: state.status,
      queue: state.queue,
      downloaded: state.downloaded,
      creations: creations.alleEintraege(),
      version: app.getVersion(),
      // The startup check may already have finished before the renderer
      // subscribes, so the current state travels with the initial payload.
      update: getUpdateState(),
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
      const folder = await realSongDir(state.downloadDir, path);
      const root = await realpath(state.downloadDir);
      if (
        (!folder && pathKey(path) !== pathKey(root)) ||
        !(await stat(folder ?? root)).isDirectory()
      )
        throw new Error("Nur Bibliotheksordner dürfen geöffnet werden.");
      const error = await shell.openPath(folder ?? root);
      if (error) throw new Error(error);
    },

    "download:single": async (song: Song) => {
      if (repairRunning || archiveImportRunning || genreEnrichRunning) {
        broadcast("event:error", {
          context: "download",
          message:
            "Die Bibliothek wird gerade bearbeitet. Bitte danach erneut starten.",
        });
        return;
      }
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
        throw new CodedError("archiveImportBusy");
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
      if (repairRunning || archiveImportRunning || genreEnrichRunning) {
        broadcast("event:error", {
          context: "queue",
          message:
            "Die Bibliothek wird gerade bearbeitet. Bitte danach erneut starten.",
        });
        return;
      }
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
      if (
        archiveImportRunning ||
        genreEnrichRunning ||
        state.queueRunning ||
        state.activeDownloads.length > 0
      ) {
        broadcast("event:error", {
          context: "repair",
          message:
            "Reparatur nicht möglich, während Downloads, Archiv-Import oder Genre-Anreicherung laufen. Bitte warten und erneut versuchen.",
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
    "environment:install": async (force?: boolean) => {
      if (vocalAnalysisRunning())
        throw new Error(
          "Bitte zuerst die Gesangsanalyse abschließen oder abbrechen.",
        );
      return installEnvironmentForApp(force === true);
    },
    "environment:cancel": async () => {
      cancelEnvironmentInstall();
    },
    "create:queueAdd": async (jobs: CreateJobRequest[]) => {
      for (const job of jobs) {
        if (
          job.quelle.kind === "datei" &&
          !selectedFiles.has(pathKey(job.quelle.pfad))
        )
          throw new Error("Please select the audio file in the file dialog");
        if (
          typeof job.coverWahl === "object" &&
          !selectedFiles.has(pathKey(job.coverWahl.pfad)) &&
          !(await safeSongFile(creationCoverDir(job.id), job.coverWahl.pfad))
        )
          throw new Error("Unknown cover file");
      }
      return creations.queueAdd(jobs);
    },
    "create:queueRemove": async (id: string) => {
      creations.queueRemove(id);
    },
    "create:queueClear": async () => {
      creations.queueClear();
    },
    "create:start": async () => {
      if (vocalAnalysisRunning())
        throw new Error(
          "Bitte zuerst die Gesangsanalyse abschließen oder abbrechen.",
        );
      await creations.start();
    },
    "create:cancel": async () => {
      creations.cancel();
    },
    "create:youtubeSearch": async (query: string) =>
      Effect.runPromise(
        Effect.catchAll(searchYoutubeVideos(query), () =>
          Effect.succeed([] as YoutubeVideo[]),
        ),
      ),
    "create:sourceInfo": async (quelle: MediaQuelle) => {
      if (quelle.kind === "datei" && !selectedFiles.has(pathKey(quelle.pfad)))
        throw new Error("Please select the audio file in the file dialog");
      const dauer = await Effect.runPromise(dauerSekunden(quelle));
      return dauer === null ? null : { durationSec: dauer };
    },
    "create:lyricsSearch": async (a: LyricsSuche) => fetchSyncedLyrics(a),
    "create:coverCandidates": async (a: CoverSuche) =>
      holeCoverKandidaten(a.jobId, {
        artist: a.artist,
        title: a.title,
        thumbnailUrl: a.thumbnailUrl,
      }),
    "create:chooseFile": async (art: "audio" | "bild") => {
      const filters =
        art === "audio"
          ? [
              {
                name: "Audio",
                extensions: ["mp3", "m4a", "wav", "flac", "ogg", "opus"],
              },
            ]
          : [{ name: "Bilder", extensions: ["jpg", "jpeg", "png", "webp"] }];
      const ergebnis = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters,
      });
      const selected = ergebnis.canceled
        ? null
        : (ergebnis.filePaths[0] ?? null);
      if (selected) selectedFiles.add(pathKey(selected));
      return selected;
    },
    "covers:get": async (apiId: number) => {
      if (!Number.isSafeInteger(apiId)) throw new Error("Ungültige Song-ID.");
      return getCoverDataUrl(apiId);
    },
    "covers:getLocal": async (songDir: string) => {
      const folder = await realSongDir(state.downloadDir, songDir);
      return folder && (await safeSongFile(folder, "cover.jpg"))
        ? getLocalCoverDataUrl(folder)
        : null;
    },
    "covers:clearCache": async () => clearCoverCaches(),

    "genres:enrich": async () => {
      if (genreEnrichRunning) {
        throw new CodedError("genreEnrichRunning");
      }
      if (
        state.queueRunning ||
        state.activeDownloads.length > 0 ||
        repairRunning ||
        archiveImportRunning
      ) {
        throw new CodedError("genreEnrichBusy");
      }
      const providerId = (state.config?.genreProvider ??
        "deezer") as GenreProviderId;
      let provider: GenreProvider;
      if (providerId === "lastfm") {
        const key = state.config?.lastfmApiKey?.trim();
        if (!key) {
          throw new CodedError("lastfmKeyMissing");
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

    "update:check": async () => checkForUpdate(),
    "update:download": async () => downloadUpdate(),
    "update:install": async () => installUpdate(),
    "editor:load": async (songDir: unknown) =>
      loadForEditor(state.downloadDir, songDir),
    "editor:save": async (req: EditorSaveRequest) =>
      saveFromEditor(state.downloadDir, req),
  };

export const registerIpcHandlers = (ipcMain: IpcMain): void => {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, payload) => {
      if (event.senderFrame !== event.sender.mainFrame)
        throw new Error("Untrusted IPC sender");
      const url = event.senderFrame.url;
      const expected =
        process.env.ELECTRON_RENDERER_URL ??
        pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
      if (
        new URL(url).origin !== new URL(expected).origin ||
        (!process.env.ELECTRON_RENDERER_URL && url.split("#")[0] !== expected)
      )
        throw new Error("Untrusted IPC origin");
      validateIpcPayload(channel as InvokeChannel, payload);
      return handler(payload);
    });
  }
};
