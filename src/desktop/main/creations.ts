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
    signal: AbortSignal,
  ) => Promise<AcquiredMedia>;
  /**
   * Writes the job's text payload into the scratch dir. The job carries text
   * because the renderer has text and the persisted queue must survive a
   * restart; the worker wants paths.
   */
  schreibeJobDateien: (
    job: CreateJobRequest,
    jobDir: string,
  ) => Promise<{ lyricsPath: string; syncedLyricsPath?: string }>;
  /** Only after success - a failed job keeps its scratch dir for diagnosis. */
  aufraeumen: (jobDir: string) => Promise<void>;
  /** Called once a job can no longer need its image candidates. */
  raeumeCover: (jobId: string) => Promise<void>;
  assemble: (
    job: CreateJobRequest,
    medien: AcquiredMedia,
    jobDir: string,
  ) => Promise<{
    songDir: string;
    dirName: string;
    warnungen: string[];
    lowConfidence: boolean;
  }>;
  /** The waiting jobs of the previous run - see initialisiere(). */
  ladeQueue: () => Promise<CreateJobRequest[]>;
  /** Failure is reported, never fatal: a full disk must not stop the queue. */
  speichereQueue: (jobs: CreateJobRequest[]) => Promise<void>;
  broadcast: <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void;
};

const toWorkerJob = (
  job: CreateJobRequest,
  medien: AcquiredMedia,
  dateien: { lyricsPath: string; syncedLyricsPath?: string },
  workDir: string,
  jobDir: string,
): WorkerJob => ({
  id: job.id,
  audioPath: medien.audioPath,
  lyricsPath: dateien.lyricsPath,
  language: job.language,
  outPath: join(jobDir, "song_data.json"),
  bpm: job.bpm,
  syncedLyricsPath: dateien.syncedLyricsPath,
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
  // During acquisition no worker job is pending, so cancelCurrentJob() alone
  // would be a no-op and yt-dlp would keep running.
  let laufenderAbbruch: AbortController | null = null;
  /** True only while the worker actually holds a job - see cancel(). */
  let workerHatAuftrag = false;

  const melde = (): void =>
    deps.broadcast("event:creations", [...eintraege.values()]);

  /**
   * Fire and swallow: a lingering Windows handle on the cover cache must not
   * turn a finished song into a reported failure. What stays behind is picked
   * up by the orphan sweep at the next app start.
   */
  const raeumeCoverStill = (id: string): void => {
    void deps.raeumeCover(id).catch(() => {});
  };

  const sichere = (): void => {
    void deps.speichereQueue([...queue]).catch((e: unknown) => {
      deps.broadcast("event:error", {
        context: "erstellen",
        message: `Queue konnte nicht gespeichert werden: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    });
  };

  /**
   * Loads the persisted queue. A stored job never ran to completion, so it
   * comes back as "queued" - and nothing is started here: a program launch
   * must not seize the GPU unasked.
   */
  const initialisiere = async (): Promise<void> => {
    const jobs = await deps.ladeQueue();
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
  };

  const wartendeIds = (): string[] => queue.map((j) => j.id);

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
    sichere();
    return queue.length;
  };

  /** Removes a waiting job; a running one has to be cancelled instead. */
  const queueRemove = (id: string): void => {
    queue = queue.filter((j) => j.id !== id);
    if (eintraege.get(id)?.status === "queued") eintraege.delete(id);
    melde();
    sichere();
    raeumeCoverStill(id);
  };

  const queueClear = (): void => {
    queue = [];
    const entfernt: string[] = [];
    for (const [id, e] of eintraege) {
      if (e.status !== "queued") continue;
      eintraege.delete(id);
      entfernt.push(id);
    }
    melde();
    sichere();
    for (const id of entfernt) raeumeCoverStill(id);
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
        // Only waiting jobs are persisted, and this one has begun: a crash
        // must not resurrect a job whose scratch dir is half written.
        sichere();
        const eintrag = eintraege.get(jobDef.id);
        if (!eintrag) continue;
        eintrag.status = "running";
        melde();
        worker ??= deps.newWorker();
        // Hold the worker in a local: cancel() clears the shared field
        // while this await is pending, and the catch below still has to
        // ask *this* worker whether it survived.
        const aktiv = worker;
        try {
          // Inside the try: jobDir() validates the id and can throw, which
          // outside would abandon the entry on "running" and drop the queue.
          const jobDir = deps.jobDir(jobDef.id);
          // Inside the try on purpose: a failed write must mark the job
          // failed, not abandon the queue.
          const dateien = await deps.schreibeJobDateien(jobDef, jobDir);
          eintrag.stage = "beschaffen";
          melde();
          laufenderAbbruch = new AbortController();
          const medien = await deps.acquire(
            jobDef,
            jobDir,
            (anteil) => {
              eintrag.progress = anteil * 0.25;
              melde();
            },
            laufenderAbbruch.signal,
          );
          workerHatAuftrag = true;
          await aktiv.submitJob(
            toWorkerJob(jobDef, medien, dateien, deps.workDir(), jobDir),
            (stage, percent) => {
              eintrag.stage = stage;
              eintrag.progress = 0.25 + percent * 0.65;
              melde();
            },
          );
          // Cleared here, not after assemble: from now on the worker is
          // idle again, so a cancel during packaging must not cost the next
          // job a cold start.
          workerHatAuftrag = false;
          eintrag.stage = "paket";
          eintrag.progress = 0.9;
          melde();
          const paket = await deps.assemble(jobDef, medien, jobDir);
          for (const w of paket.warnungen) {
            deps.broadcast("event:error", { context: "warnung", message: w });
          }
          eintrag.songDir = paket.songDir;
          eintrag.dirName = paket.dirName;
          eintrag.lowConfidence = paket.lowConfidence;
          eintrag.status = "completed";
          eintrag.progress = 1;
          crashStreak = 0;
          // After the status, and swallowing: the song is in the library. A
          // scratch dir that will not go away (Windows keeps a handle on it
          // more often than one would like) must not turn a finished job
          // into a reported failure. try/catch, not .catch(): a dep that
          // throws synchronously would never reach a rejection handler.
          try {
            await deps.aufraeumen(jobDir);
          } catch {
            // Scratch dir stays behind; the job succeeded regardless.
          }
        } catch (fehler) {
          const hatteAuftrag = workerHatAuftrag;
          workerHatAuftrag = false;
          if (istAbbruch(fehler)) {
            eintrag.status = "cancelled";
            // Only a worker that actually held the job was killed. One that
            // was cancelled during acquisition is idle and warm - throwing
            // it away would cost the next job a full model reload.
            if (hatteAuftrag) worker = null;
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
        // One place for success, failure and cancel alike: whichever way the
        // job left the worker, its image candidates are spent.
        raeumeCoverStill(jobDef.id);
        melde();
      }
    } finally {
      running = false;
    }
  };

  /** Cancels the running job; the queue continues with the next one. */
  const cancel = (): void => {
    laufenderAbbruch?.abort();
    laufenderAbbruch = null;
    if (workerHatAuftrag) {
      worker?.cancelCurrentJob();
      worker = null;
    }
  };

  /** App exit: no orphaned python process holding warm VRAM. */
  const shutdown = async (): Promise<void> => {
    // No sichere() here on purpose: emptying the in-memory queue is how this
    // process stops, not a user decision - the file has to survive the exit.
    queue = [];
    // Closing the app mid-download must not orphan yt-dlp - the same reason
    // cancel() carries an AbortController.
    laufenderAbbruch?.abort();
    laufenderAbbruch = null;
    workerHatAuftrag = false;
    const alt = worker;
    worker = null;
    alt?.cancelCurrentJob();
    await alt?.shutdown();
  };

  return {
    initialisiere,
    queueAdd,
    queueRemove,
    queueClear,
    start,
    cancel,
    shutdown,
    wartendeIds,
    /** A snapshot, for the initial state the renderer asks for at mount. */
    alleEintraege: (): CreationEntry[] => [...eintraege.values()],
  };
};
