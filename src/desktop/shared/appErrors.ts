// src/desktop/shared/appErrors.ts
// Errors the main process can name but should not word: it does not know
// the UI language. It sends a code, the renderer turns it into a sentence.

export const APP_ERROR_CODES = [
  "archiveImportBusy",
  "repairBusy",
  "genreEnrichRunning",
  "genreEnrichBusy",
  "lastfmKeyMissing",
  "envSetupRunning",
  "aiEnvMissing",
  "aiEnvOutdated",
  "workerCrashLimit",
  "queueSaveFailed",
  "toolsMissing",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const MARKER = "US_ERR:";

/**
 * For errors thrown inside an ipcMain.handle handler. Electron passes only
 * the message string on ("Error invoking remote method …: Error: …"), so
 * the code travels inside it behind a marker.
 */
export class CodedError extends Error {
  constructor(readonly code: AppErrorCode) {
    super(`${MARKER}${code}`);
  }
}

const istCode = (v: string): v is AppErrorCode =>
  (APP_ERROR_CODES as readonly string[]).includes(v);

/** The code inside a rejected invoke, or null for any other error. */
export const errorCodeOf = (e: unknown): AppErrorCode | null => {
  const text = e instanceof Error ? e.message : String(e);
  const m = /US_ERR:([A-Za-z]+)/.exec(text);
  return m && istCode(m[1] as string) ? (m[1] as AppErrorCode) : null;
};
