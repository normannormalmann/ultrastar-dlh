// src/desktop/main/creations.ts
// Song creation queue: one job at a time (one GPU), a long-lived worker
// with warm models, and a crash brake. Deliberately electron-free so the
// queue logic is testable without electron mocks - the wired instance
// lives in ipc.ts, where electron imports belong.
import type { SidecarWorker, WorkerJob } from "../../core/create/worker.ts";
import type { EnvironmentStatus } from "../../core/create/environment.ts";
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
  broadcast: <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void;
};

const toWorkerJob = (job: CreateJobRequest): WorkerJob => ({
  id: job.id,
  audioPath: job.audioPath,
  lyricsPath: job.lyricsPath,
  language: job.language,
  outPath: job.outPath,
  bpm: job.bpm,
  syncedLyricsPath: job.syncedLyricsPath,
});

const fehlerText = (fehler: unknown): string => {
  if (typeof fehler === "object" && fehler !== null && "kind" in fehler) {
    const f = fehler as { kind: string; detail?: string };
    return f.detail ?? f.kind;
  }
  return fehler instanceof Error ? fehler.message : String(fehler);
};

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
      deps.broadcast("event:error", {
        context: "warnung",
        message:
          "KI-Umgebung ist veraltet - Lauf mit alter Version (Einstellungen -> Aktualisieren).",
      });
    }
    running = true;
    crashStreak = 0;
    try {
      while (queue.length > 0) {
        const jobDef = queue.shift() as CreateJobRequest;
        const eintrag = eintraege.get(jobDef.id);
        if (!eintrag) continue;
        eintrag.status = "running";
        melde();
        worker ??= deps.newWorker();
        try {
          await worker.submitJob(toWorkerJob(jobDef), (stage, percent) => {
            eintrag.stage = stage;
            eintrag.progress = percent;
            melde();
          });
          eintrag.status = "completed";
          eintrag.progress = 1;
          crashStreak = 0;
        } catch (fehler) {
          eintrag.status = "failed";
          eintrag.error = fehlerText(fehler);
          // A worker that died mid-job counts towards the crash brake;
          // a domain error (worker still alive) does not.
          if (!worker.isAlive()) {
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
          } else {
            crashStreak = 0;
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
