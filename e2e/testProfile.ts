import { basename, dirname, join, resolve } from "node:path";
import envPaths from "env-paths";

/** Where the app keeps config.json & co. for this app name (see core/storage/paths.ts). */
export const datenOrdner = (appName: string): string =>
  process.env.ULTRASTAR_DATA_ROOT
    ? join(resolve(process.env.ULTRASTAR_DATA_ROOT), appName)
    : envPaths(appName, { suffix: "" }).cache;

/**
 * The folder to delete after a test: the app's own, never a shared parent.
 * env-paths nests the cache differently per platform - Windows
 * %LOCALAPPDATA%\<name>\Cache, Linux ~/.cache/<name>, macOS
 * ~/Library/Caches/<name> - so dirname() of it is the app folder only on
 * Windows. On Linux it was ~/.cache itself, and the cleanup wiped every
 * other profile in it, the user's included.
 */
export const profilOrdner = (appName: string): string => {
  const cache = datenOrdner(appName);
  return basename(dirname(cache)) === appName ? dirname(cache) : cache;
};
