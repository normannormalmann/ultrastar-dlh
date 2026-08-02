// src/desktop/main/creations.ts
// Song creation queue: one job at a time (one GPU), a long-lived worker
// with warm models, and a crash brake. Deliberately electron-free so the
// queue logic is testable without electron mocks - the wired instance
// lives in ipc.ts, where electron imports belong.
import { join } from "node:path";
import type { SidecarWorker, WorkerJob } from "../../core/create/worker.ts";
import type { EnvironmentStatus } from "../../core/create/environment.ts";
import type { AcquiredMedia } from "../../core/create/media.ts";
import type { FolderLayout } from "../../core/download/naming.ts";
import type {
  CreateJobRequest,
  CreationEntry,
  EventChannel,
  EventPayloads,
} from "../shared/ipcContract.ts";

/** Three crashes in a row stop the queue instead of restart-looping. */
const CRASH_LIMIT = 3;

export type WorkerLike = Pick<
  SidecarWorker,
  "submitJob" | "cancelCurrentJob" | "shutdown" | "isAlive"
>;

export type CreationsDeps = {
  newWorker: () => WorkerLike;
  environmentStatus: () => Promise<EnvironmentStatus>;
  /** Lazy: electron can only answer these once the app is ready. */
  workDir: () => string;
  jobDir: (jobId: string) => string;
  libraryDir: () => string;
  layout: () => FolderLayout;
  acquire: (
    job: CreateJobRequest,
    jobDir: string,
    onProgress: (anteil: number) => void,
  ) => Promise<AcquiredMedia>;
  assemble: (
    job: CreateJobRequest,
    medien: AcquiredMedia,
    jobDir: string,
  ) => Promise<{ songDir: string; dirName: string; warnungen: string[] }>;
  broadcast: <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void;
};

const toWorkerJob = (
  job: CreateJobRequest,
  medien: AcquiredMedia,
  workDir: string,
  jobDir: string,
): WorkerJob => ({
  id: job.id,
  audioPath: medien.audioPath,
  lyricsPath: job.lyricsPath,
  language: job.language,
  outPath: join(jobDir, "song_data.json"),
  bpm: job.bpm,
  syncedLyricsPath: job.syncedLyricsPath,
  workDir,
});

const fehlerText = (fehler: unknown): string => {
  if (typeof fehler === "object" && fehler !== null && "kind" in fehler) {
    const f = fehler as { kind: string; detail?: string };
    return f.detail ?? f.kind;
  }
  return fehler instanceof Error ? fehler.message : String(fehler);
};

/** A cancel is a user decision, not a worker fault - it must not brake the queue. */
const istAbbruch = (fehler: unknown): boolean =>
  typeof fehler === "object" &&
  fehler !== null &&
  (fehler as { kind?: string }).kind === "Cancelled";

export const createCreations = (deps: CreationsDeps) => {
  let queue: CreateJobRequest[] = [];
  const eintraege = new Map<string, CreationEntry>();
  let running = false;
  let crashStreak = 0;
  let worker: WorkerLike | null = null;

  const melde = (): void =>
    deps.broadcast("event:creations", [...eintraege.values()]);

  const queueAdd = (jobs: CreateJobRequest[]): number => {
    for (const j of jobs) {
      if (eintraege.has(j.id)) continue;
      queue.push(j);
      eintraege.set(j.id, {
        id: j.id,
        artist: j.artist,
        title: j.title,
        status: "queued",
      });
    }
    melde();
    return queue.length;
  };

  /** Removes a waiting job; a running one has to be cancelled instead. */
  const queueRemove = (id: string): void => {
    queue = queue.filter((j) => j.id !== id);
    if (eintraege.get(id)?.status === "queued") eintraege.delete(id);
    melde();
  };

  const queueClear = (): void => {
    queue = [];
    for (const [id, e] of eintraege) if (e.status === "queued") eintraege.delete(id);
    melde();
  };

  const start = async (): Promise<void> => {
    if (running || queue.length === 0) return;
    // Claim the queue *before* the first await. The environment check is
    // async, so a guard behind it would let a second start() (double click
    // on the UI button) slip through and submit a job into the busy worker.
    running = true;
    try {
      const env = await deps.environmentStatus();
      if (env.state === "missing" || env.state === "broken") {
        deps.broadcast("event:error", {
          context: "erstellen",
          message:
            "KI-Umgebung ist nicht eingerichtet (Einstellungen -> KI-Umgebung).",
        });
        return;
      }
      if (env.state === "outdated") {
        // "outdated" is a content hash mismatch, so it includes the case
        // "the installed sidecar predates the worker protocol". Running
        // anyway would burn three 120 s READY timeouts before the crash
        // brake pauses the queue - measured during the subproject-3 run.
        deps.broadcast("event:error", {
          context: "erstellen",
          message:
            "KI-Umgebung ist veraltet - bitte aktualisieren (Einstellungen -> KI-Umgebung).",
        });
        return;
      }
      crashStreak = 0;
      while (queue.length > 0) {
        const jobDef = queue.shift() as CreateJobRequest;
        const eintrag = eintraege.get(jobDef.id);
        if (!eintrag) continue;
        eintrag.status = "running";
        melde();
        worker ??= deps.newWorker();
        // Hold the worker in a local: cancel() clears the shared field
        // while this await is pending, and the catch below still has to
        // ask *this* worker whether it survived.
        const aktiv = worker;
        const jobDir = deps.jobDir(jobDef.id);
        try {
          eintrag.stage = "beschaffen";
          melde();
          const medien = await deps.acquire(jobDef, jobDir, (anteil) => {
            eintrag.progress = anteil * 0.25;
            melde();
          });
          await aktiv.submitJob(
            toWorkerJob(jobDef, medien, deps.workDir(), jobDir),
            (stage, percent) => {
              eintrag.stage = stage;
              eintrag.progress = 0.25 + percent * 0.65;
              melde();
            },
          );
          eintrag.stage = "paket";
          eintrag.progress = 0.9;
          melde();
          const paket = await deps.assemble(jobDef, medien, jobDir);
          for (const w of paket.warnungen) {
            deps.broadcast("event:error", { context: "warnung", message: w });
          }
          eintrag.status = "completed";
          eintrag.progress = 1;
          crashStreak = 0;
        } catch (fehler) {
          if (istAbbruch(fehler)) {
            // cancel() killed the process; the next job gets a fresh worker.
            eintrag.status = "cancelled";
            worker = null;
            crashStreak = 0;
          } else {
            eintrag.status = "failed";
            eintrag.error = fehlerText(fehler);
            // A worker that died mid-job counts towards the crash brake;
            // a domain error (worker still alive) does not.
            if (aktiv.isAlive()) {
              crashStreak = 0;
            } else {
              worker = null;
              crashStreak += 1;
              if (crashStreak >= CRASH_LIMIT) {
                deps.broadcast("event:error", {
                  context: "erstellen",
                  message: "Drei Worker-Abstuerze in Folge - Queue pausiert.",
                });
                melde();
                return;
              }
            }
          }
        }
        melde();
      }
    } finally {
      running = false;
    }
  };

  /** Cancels the running job; the queue continues with the next one. */
  const cancel = (): void => {
    worker?.cancelCurrentJob();
    worker = null;
  };

  /** App exit: no orphaned python process holding warm VRAM. */
  const shutdown = async (): Promise<void> => {
    queue = [];
    const alt = worker;
    worker = null;
    alt?.cancelCurrentJob();
    await alt?.shutdown();
  };

  return {
    queueAdd,
    queueRemove,
    queueClear,
    start,
    cancel,
    shutdown,
    entriesForTests: (): CreationEntry[] => [...eintraege.values()],
  };
};
