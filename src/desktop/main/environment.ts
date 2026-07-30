// Desktop wiring for the managed sidecar environment - same shape as
// binaries.ts: status query, install with progress broadcast, install lock
// (the lock itself lives in core installEnvironment).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { app } from "electron";
import {
  defaultRunner,
  environmentStatus,
  installEnvironment,
  sidecarVersionFromPyproject,
  type EnvironmentStatus as Status,
} from "../../core/create/environment.ts";
import { managedBinDir } from "./binaries.ts";
import { broadcast } from "./state.ts";

export const managedEnvDir = (): string =>
  join(app.getPath("userData"), "python-env");

/** Packaged builds carry the sidecar as an extraResource; dev uses the repo. */
export const sidecarDir = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "python-sidecar")
    : join(app.getAppPath(), "python-sidecar");

const bundledSidecarVersion = async (): Promise<string> => {
  try {
    const text = await readFile(join(sidecarDir(), "pyproject.toml"), "utf8");
    return sidecarVersionFromPyproject(text) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const environmentStatusForApp = async (): Promise<Status> =>
  Effect.runPromise(
    environmentStatus(managedEnvDir(), await bundledSidecarVersion()),
  );

let laufenderAbbruch: AbortController | null = null;

export const installEnvironmentForApp = async (
  force: boolean,
): Promise<Status> => {
  // A renderer reload or a second window can invoke this again while an
  // install is still running. Without this guard, the second call would
  // overwrite laufenderAbbruch unconditionally and null it out in ITS OWN
  // finally - leaving the still-running first install unabortable and
  // sending the UI a stray progress=null/status mid-install.
  if (laufenderAbbruch !== null) {
    throw new Error("Eine Einrichtung laeuft bereits.");
  }
  const abbruch = new AbortController();
  laufenderAbbruch = abbruch;
  try {
    const status = await Effect.runPromise(
      installEnvironment({
        envDir: managedEnvDir(),
        binDir: managedBinDir(),
        sidecarDir: sidecarDir(),
        bundledSidecarVersion: await bundledSidecarVersion(),
        force,
        signal: abbruch.signal,
        runner: defaultRunner(abbruch.signal),
        onProgress: (p) => broadcast("event:environmentProgress", p),
      }),
    );
    return status;
  } finally {
    // Identity-guarded: only clear/broadcast if this call's controller is
    // still the current one (i.e. no other install has started since).
    if (laufenderAbbruch === abbruch) {
      laufenderAbbruch = null;
      broadcast("event:environmentProgress", null);
      broadcast("event:environmentStatus", await environmentStatusForApp());
    }
  }
};

export const cancelEnvironmentInstall = (): void => {
  laufenderAbbruch?.abort();
};
