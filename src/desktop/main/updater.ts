// src/desktop/main/updater.ts
// In-app updates against the GitHub release feed. The app never installs on
// its own: it checks, tells the renderer what it found, and waits. Downloads
// and creations run for minutes here, so a self-triggered restart would be a
// good way to destroy someone's work.
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "../shared/ipcContract.ts";
import { broadcast } from "./state.ts";

let current: UpdateState = { phase: "idle" };

const setState = (next: UpdateState): void => {
  current = next;
  broadcast("event:update", current);
};

export const getUpdateState = (): UpdateState => current;

const fehlertext = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * An unpackaged app has no app-update.yml, so electron-updater would throw on
 * every call. Reporting that as an error would put a red box in front of the
 * developer on every start.
 */
const updatesAvailable = (): boolean => app.isPackaged;

/** Ask the feed. Resolves with the state the check ended in. */
export const checkForUpdate = async (): Promise<UpdateState> => {
  if (!updatesAvailable()) {
    setState({ phase: "disabled" });
    return current;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    // A missing network connection is not worth a dialog - the settings view
    // shows the message and the next check can succeed.
    setState({ phase: "error", message: fehlertext(e) });
  }
  return current;
};

/**
 * Wire the updater once at startup and check in the background. Nothing is
 * downloaded here - the check only moves the state the settings view renders.
 */
export const initUpdater = (): void => {
  autoUpdater.autoDownload = false;
  // A downloaded update is applied when the user closes the app anyway, which
  // is the one moment where nothing is running.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => setState({ phase: "checking" }));
  autoUpdater.on("update-available", (info) =>
    setState({ phase: "available", version: info.version }),
  );
  autoUpdater.on("update-not-available", (info) =>
    setState({ phase: "uptodate", version: info.version }),
  );
  autoUpdater.on("download-progress", (p) =>
    setState({
      phase: "downloading",
      version: autoUpdater.currentVersion.version,
      percent: Math.max(0, Math.min(1, p.percent / 100)),
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    setState({ phase: "ready", version: info.version }),
  );
  autoUpdater.on("error", (e) =>
    setState({ phase: "error", message: fehlertext(e) }),
  );

  if (!updatesAvailable()) {
    setState({ phase: "disabled" });
    return;
  }
  void checkForUpdate();
};

/** Fetch the installer. Progress arrives through event:update. */
export const downloadUpdate = async (): Promise<void> => {
  if (current.phase !== "available") return;
  setState({ phase: "downloading", version: current.version, percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    setState({ phase: "error", message: fehlertext(e) });
  }
};

/**
 * Quit and run the installer. Only ever reached through an explicit click,
 * and only once an update is actually on disk.
 */
export const installUpdate = (): void => {
  if (current.phase !== "ready") return;
  autoUpdater.quitAndInstall();
};
