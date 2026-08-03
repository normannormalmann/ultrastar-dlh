import { contextBridge, ipcRenderer } from "electron";
import {
  EVENT_CHANNELS,
  type EventChannel,
  type EventPayloads,
  type UltrastarApi,
} from "../shared/ipcContract.ts";

const on = <C extends EventChannel>(
  channel: C,
  listener: (payload: EventPayloads[C]) => void,
): (() => void) => {
  if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`Unknown event channel: ${channel}`);
  }
  const wrapped = (
    _event: Electron.IpcRendererEvent,
    payload: EventPayloads[C],
  ) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

const api: UltrastarApi = {
  getInitialState: () => ipcRenderer.invoke("app:getInitialState"),
  search: (req) => ipcRenderer.invoke("usdb:search", req),
  downloadSingle: (song) => ipcRenderer.invoke("download:single", song),
  failedList: () => ipcRenderer.invoke("downloads:failedList"),
  archiveImport: () => ipcRenderer.invoke("archive:import"),
  libraryRefresh: () => ipcRenderer.invoke("library:refresh"),
  queueAdd: (songs) => ipcRenderer.invoke("queue:add", songs),
  queueRemove: (apiId) => ipcRenderer.invoke("queue:remove", apiId),
  queueClear: () => ipcRenderer.invoke("queue:clear"),
  queueStart: () => ipcRenderer.invoke("queue:start"),
  queueCancel: () => ipcRenderer.invoke("queue:cancel"),
  queueFetchAllPages: (req) => ipcRenderer.invoke("queue:fetchAllPages", req),
  queueEntireDatabase: () => ipcRenderer.invoke("queue:entireDatabase"),
  repairStart: () => ipcRenderer.invoke("repair:start"),
  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsSave: (config) => ipcRenderer.invoke("settings:save", config),
  chooseDirectory: () => ipcRenderer.invoke("settings:chooseDirectory"),
  binariesStatus: () => ipcRenderer.invoke("binaries:status"),
  binariesInstall: (force) => ipcRenderer.invoke("binaries:install", force),
  environmentStatus: () => ipcRenderer.invoke("environment:status"),
  environmentInstall: (force) =>
    ipcRenderer.invoke("environment:install", force),
  environmentCancel: () => ipcRenderer.invoke("environment:cancel"),
  createQueueAdd: (jobs) => ipcRenderer.invoke("create:queueAdd", jobs),
  createQueueRemove: (id) => ipcRenderer.invoke("create:queueRemove", id),
  createQueueClear: () => ipcRenderer.invoke("create:queueClear"),
  createStart: () => ipcRenderer.invoke("create:start"),
  createCancel: () => ipcRenderer.invoke("create:cancel"),
  createYoutubeSearch: (query) =>
    ipcRenderer.invoke("create:youtubeSearch", query),
  createSourceInfo: (quelle) => ipcRenderer.invoke("create:sourceInfo", quelle),
  createLyricsSearch: (a) => ipcRenderer.invoke("create:lyricsSearch", a),
  createCoverCandidates: (a) => ipcRenderer.invoke("create:coverCandidates", a),
  createChooseFile: (art) => ipcRenderer.invoke("create:chooseFile", art),
  coverGet: (apiId) => ipcRenderer.invoke("covers:get", apiId),
  coverGetLocal: (songDir) => ipcRenderer.invoke("covers:getLocal", songDir),
  coversClearCache: () => ipcRenderer.invoke("covers:clearCache"),
  openFolder: (path) => ipcRenderer.invoke("shell:openFolder", path),
  genresEnrich: () => ipcRenderer.invoke("genres:enrich"),
  genresCancel: () => ipcRenderer.invoke("genres:cancel"),
  on,
};

contextBridge.exposeInMainWorld("ultrastar", api);
