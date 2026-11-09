import { EVENT_CHANNELS, type InvokeChannel } from "./ipcContract.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown, max = 4096): value is string =>
  typeof value === "string" && value.length <= max && !value.includes("\0");
const id = (value: unknown): boolean => Number.isSafeInteger(value);
const song = (value: unknown): boolean =>
  object(value) &&
  id(value.apiId) &&
  string(value.artist, 512) &&
  string(value.title, 512) &&
  Array.isArray(value.languages) &&
  value.languages.every((item) => string(item, 100));
export const youtubeUrl = (value: unknown): boolean => {
  if (!string(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "music.youtube.com",
      ].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
const source = (value: unknown): boolean =>
  object(value) &&
  (value.kind === "youtube"
    ? youtubeUrl(value.url)
    : value.kind === "datei" && string(value.pfad));
const singleLine = (value: unknown): boolean =>
  string(value, 512) && !/[\r\n]/.test(value);
const job = (value: unknown): boolean =>
  object(value) &&
  string(value.id, 128) &&
  /^[\w-]+$/.test(value.id) &&
  source(value.quelle) &&
  singleLine(value.artist) &&
  singleLine(value.title) &&
  singleLine(value.language) &&
  string(value.lyricsText, 1_000_000) &&
  (value.syncedLyricsText === undefined ||
    string(value.syncedLyricsText, 1_000_000)) &&
  (value.genre === undefined || singleLine(value.genre)) &&
  (value.year === undefined || id(value.year)) &&
  (value.bpm === undefined ||
    (typeof value.bpm === "number" &&
      Number.isFinite(value.bpm) &&
      value.bpm > 0)) &&
  (value.coverWahl === undefined ||
    value.coverWahl === "keins" ||
    (object(value.coverWahl) && string(value.coverWahl.pfad)));
const search = (value: unknown): boolean =>
  object(value) &&
  string(value.artist, 512) &&
  string(value.title, 512) &&
  (value.page === undefined || (id(value.page) && Number(value.page) > 0));

/** TypeScript does not validate data crossing the renderer boundary. */
export const validateIpcPayload = (
  channel: InvokeChannel,
  value: unknown,
): void => {
  let valid: boolean;
  switch (channel) {
    case "app:getEventState":
      valid =
        typeof value === "string" &&
        (EVENT_CHANNELS as readonly string[]).includes(value);
      break;
    case "download:single":
    case "search:preview":
      valid = song(value);
      break;
    case "queue:add":
      valid =
        Array.isArray(value) && value.length <= 50_000 && value.every(song);
      break;
    case "create:queueAdd":
      valid = Array.isArray(value) && value.length <= 100 && value.every(job);
      break;
    case "queue:remove":
    case "covers:get":
      valid = id(value);
      break;
    case "usdb:search":
    case "queue:fetchAllPages":
      valid = search(value);
      break;
    case "editor:load":
    case "editor:cancelAnalysis":
    case "covers:getLocal":
    case "shell:openFolder":
    case "library:usdbCheck":
    case "create:youtubeSearch":
    case "create:queueRemove":
      valid = string(value);
      break;
    case "library:usdbApply":
      valid =
        object(value) &&
        string(value.songDir) &&
        string(value.localRevision, 64) &&
        string(value.remoteRevision, 64) &&
        (value.keepLocal === undefined || typeof value.keepLocal === "boolean");
      break;
    case "editor:save":
      valid =
        object(value) &&
        string(value.songDir) &&
        string(value.revision, 64) &&
        object(value.song) &&
        Array.isArray(value.song.headers) &&
        Array.isArray(value.song.tracks) &&
        value.song.tracks.length <= 32;
      break;
    case "editor:analyze":
      valid =
        object(value) &&
        string(value.songDir) &&
        [48, 60].includes(value.midiOffset as number);
      break;
    case "settings:save":
      valid =
        object(value) &&
        string(value.downloadDir) &&
        typeof value.browser === "string" &&
        [
          "edge",
          "chrome",
          "firefox",
          "brave",
          "chromium",
          "opera",
          "vivaldi",
        ].includes(value.browser) &&
        (value.downloadConcurrency === undefined ||
          (id(value.downloadConcurrency) &&
            Number(value.downloadConcurrency) >= 1 &&
            Number(value.downloadConcurrency) <= 5));
      break;
    case "binaries:install":
    case "environment:install":
      valid = value === undefined || typeof value === "boolean";
      break;
    case "create:sourceInfo":
      valid = source(value);
      break;
    case "create:lyricsSearch":
      valid =
        object(value) && singleLine(value.artist) && singleLine(value.title);
      break;
    case "create:coverCandidates":
      valid =
        object(value) &&
        string(value.jobId, 128) &&
        /^[\w-]+$/.test(value.jobId) &&
        singleLine(value.artist) &&
        singleLine(value.title) &&
        (value.thumbnailUrl === undefined || string(value.thumbnailUrl));
      break;
    case "create:chooseFile":
      valid = value === "audio" || value === "bild";
      break;
    default:
      valid = value === undefined;
  }
  if (!valid) throw new Error(`Invalid payload for ${channel}`);
};
