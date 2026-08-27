// Desktop wiring for the managed sidecar environment - same shape as
// binaries.ts: status query, install with progress broadcast, install lock
// (the lock itself lives in core installEnvironment).
import { join } from "node:path";
import { Effect } from "effect";
import { app } from "electron";
import {
  defaultRunner,
  environmentStatus,
  installEnvironment,
  sidecarFingerprint,
  type EnvironmentStatus as Status,
} from "../../core/create/environment.ts";
import { managedBinDir } from "./binaries.ts";
import { broadcast } from "./state.ts";

export const managedEnvDir = (): string =>
  join(app.getPath("userData"), "python-env");

/**
 * Stage cache for creation jobs. Passed explicitly on purpose: the sidecar
 * falls back to ".pipeline-cache" *relative to the process cwd*, which in a
 * packaged install is wherever the exe sits - often not writable.
 */
export const creationWorkDir = (): string =>
  join(app.getPath("userData"), "pipeline-cache");

/**
 * Scratch space for one job's media. Deliberately separate from
 * creationWorkDir(): that one is the sidecar's stage cache, keyed by audio
 * hash and shared across jobs on purpose. Media must not pollute it.
 */
export const creationJobDir = (jobId: string): string => {
  // The result is handed to rm(recursive, force) after a finished job. An
  // id containing ".." would delete outside the jobs folder, so it is
  // rejected here rather than trusted from the renderer.
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
    throw new Error(`Ungueltige Job-Id: ${jobId}`);
  }
  return join(app.getPath("userData"), "jobs", jobId);
};

/**
 * Where step 4's image candidates live. Outside the job dir on purpose: they
 * are fetched before the job exists. Hence the orphan sweep in
 * coverCandidates.ts.
 */
export const creationCoverDir = (jobId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
    throw new Error(`Ungueltige Job-Id: ${jobId}`);
  }
  return join(app.getPath("userData"), "create-cover", jobId);
};

/** Packaged builds carry the sidecar as an extraResource; dev uses the repo. */
export const sidecarDir = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "python-sidecar")
    : join(app.getAppPath(), "python-sidecar");

/** Content hash of the bundled sidecar - the freshness reference. */
const bundledFingerprint = async (): Promise<string> =>
  sidecarFingerprint(sidecarDir());

export const environmentStatusForApp = async (): Promise<Status> =>
  Effect.runPromise(
    environmentStatus(managedEnvDir(), await bundledFingerprint()),
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
        bundledFingerprint: await bundledFingerprint(),
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
