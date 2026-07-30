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
  laufenderAbbruch = new AbortController();
  try {
    const status = await Effect.runPromise(
      installEnvironment({
        envDir: managedEnvDir(),
        binDir: join(app.getPath("userData"), "bin"),
        sidecarDir: sidecarDir(),
        bundledSidecarVersion: await bundledSidecarVersion(),
        force,
        signal: laufenderAbbruch.signal,
        runner: defaultRunner(laufenderAbbruch.signal),
        onProgress: (p) => broadcast("event:environmentProgress", p),
      }),
    );
    return status;
  } finally {
    laufenderAbbruch = null;
    broadcast("event:environmentProgress", null);
    broadcast("event:environmentStatus", await environmentStatusForApp());
  }
};

export const cancelEnvironmentInstall = (): void => {
  laufenderAbbruch?.abort();
};
