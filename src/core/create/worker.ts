// src/core/create/worker.ts
// Long-lived sidecar worker client: one process, many jobs, warm models.
// The idle shutdown gives the GPU memory back when nobody creates songs
// for a while. Line demux mirrors runPipeline's marker protocol; job
// boundaries come from the @@READY and @@JOB lines the worker emits.
import { spawn, type ChildProcess } from "node:child_process";
import { resolvePythonBin } from "./environment.ts";
import { baueDetail, FEHLER_ABBILDUNG, type PipelineError } from "./pipeline.ts";
import { killProcessTree } from "./processTree.ts";

export type WorkerJob = {
  id: string;
  audioPath: string;
  lyricsPath: string;
  language: string;
  outPath: string;
  bpm?: number;
  syncedLyricsPath?: string;
  workDir?: string;
  device?: "auto" | "cuda" | "cpu";
};

export type WorkerOptions = {
  pythonBin?: string;
  managedEnvDir?: string;
  /** Shut the worker down after this much idle time (default 5 minutes). */
  idleMs?: number;
  readyTimeoutMs?: number;
  spawnFn?: typeof spawn;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

type RunningJob = {
  id: string;
  resolve: () => void;
  reject: (fehler: PipelineError) => void;
  onProgress?: (stage: string, percent: number) => void;
  /** Last @@ERROR seen for this job; @@JOB ok:false reports it. */
  lastError: PipelineError | null;
};

const READY = "@@READY";
const PROGRESS_PREFIX = "@@PROGRESS ";
const ERROR_PREFIX = "@@ERROR ";
const JOB_PREFIX = "@@JOB ";
const SHUTDOWN_GRACE_MS = 5_000;

export class SidecarWorker {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private current: RunningJob | null = null;
  private idleTimer: unknown = null;
  private stderrTail = "";

  constructor(private readonly opts: WorkerOptions = {}) {}

  isAlive(): boolean {
    return this.child !== null;
  }

  async submitJob(
    job: WorkerJob,
    onProgress?: (stage: string, percent: number) => void,
  ): Promise<void> {
    if (this.current) {
      throw {
        kind: "PipelineFailed",
        detail: "Es laeuft bereits ein Auftrag.",
      } satisfies PipelineError;
    }
    this.stopIdleTimer();
    await this.startIfNeeded();
    return new Promise<void>((resolve, reject) => {
      this.current = { id: job.id, resolve, reject, onProgress, lastError: null };
      const zeile = JSON.stringify({
        id: job.id,
        audio: job.audioPath,
        lyricsFile: job.lyricsPath,
        language: job.language,
        out: job.outPath,
        bpm: job.bpm,
        device: job.device,
        workDir: job.workDir,
        syncedLyrics: job.syncedLyricsPath,
      });
      this.child?.stdin?.write(`${zeile}\n`);
    }).finally(() => {
      this.current = null;
      this.startIdleTimer();
    });
  }

  /**
   * Abort the running job. Mid-demucs there is nothing finer than killing
   * the tree, so the next job pays one cold start. The process is marked
   * dead first so the exit handler does not report the job twice.
   */
  cancelCurrentJob(): void {
    const child = this.child;
    if (!child) return;
    const running = this.current;
    this.child = null;
    this.ready = null;
    this.current = null;
    this.stopIdleTimer();
    killProcessTree(child);
    running?.reject({ kind: "Cancelled" });
  }

  async shutdown(): Promise<void> {
    this.stopIdleTimer();
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.ready = null;
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    child.stdin?.end();
    // Grace period, then hard kill - a worker stuck in native code would
    // otherwise hold gigabytes of VRAM forever.
    const frist = setTimeout(() => killProcessTree(child), SHUTDOWN_GRACE_MS);
    await closed;
    clearTimeout(frist);
  }

  private async startIfNeeded(): Promise<void> {
    if (this.child && this.ready) {
      await this.ready;
      return;
    }
    const bin = resolvePythonBin(this.opts.pythonBin, this.opts.managedEnvDir);
    // A .ts stand-in worker runs through bun, real Python as a module.
    const [befehl, vorArgs] = bin.endsWith(".ts")
      ? (["bun", [bin]] as const)
      : ([bin, ["-m", "ultrastar_pipeline", "--worker"]] as const);
    const spawnFn = this.opts.spawnFn ?? spawn;
    const child = spawnFn(befehl, [...vorArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      // POSIX only: makes the child a group leader so process.kill(-pid)
      // hits the whole tree. On Windows taskkill /t does that instead.
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.stderrTail = "";

    let becameReady!: () => void;
    let readyFailed!: (fehler: PipelineError) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      becameReady = resolve;
      readyFailed = reject;
    });
    const readyFrist = setTimeout(() => {
      readyFailed({
        kind: "PipelineFailed",
        detail: "Worker meldet sich nicht (READY-Timeout).",
      });
      this.cancelCurrentJob();
    }, this.opts.readyTimeoutMs ?? 120_000);

    let rest = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (stueck: string) => {
      rest += stueck;
      const zeilen = rest.split("\n");
      rest = zeilen.pop() ?? "";
      for (const zeile of zeilen) this.handleLine(zeile.trimEnd(), becameReady);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (s: string) => {
      this.stderrTail = (this.stderrTail + s).slice(-500);
    });
    child.on("error", (fehler: Error) => {
      readyFailed({ kind: "PipelineFailed", detail: fehler.message });
    });
    child.on("close", (code) => {
      if (this.child !== child) return; // already replaced or cancelled
      this.child = null;
      this.ready = null;
      const running = this.current;
      this.current = null;
      running?.reject({
        kind: "PipelineFailed",
        detail: `Worker beendet (Exit ${code ?? "?"}). ${this.stderrTail}`.trim(),
      });
    });

    try {
      await this.ready;
    } finally {
      clearTimeout(readyFrist);
    }
  }

  private handleLine(zeile: string, becameReady: () => void): void {
    if (zeile === READY) {
      becameReady();
      return;
    }
    if (zeile.startsWith(PROGRESS_PREFIX)) {
      try {
        const p = JSON.parse(zeile.slice(PROGRESS_PREFIX.length));
        this.current?.onProgress?.(String(p.stage), Number(p.percent));
      } catch {
        // A garbled progress line is no reason to abort.
      }
      return;
    }
    if (zeile.startsWith(ERROR_PREFIX)) {
      try {
        const fehler = JSON.parse(zeile.slice(ERROR_PREFIX.length));
        if (this.current) {
          this.current.lastError = {
            kind: FEHLER_ABBILDUNG[fehler.kind] ?? "PipelineFailed",
            detail: baueDetail(fehler),
          };
        }
      } catch {
        // See above.
      }
      return;
    }
    if (zeile.startsWith(JOB_PREFIX)) {
      try {
        const ende = JSON.parse(zeile.slice(JOB_PREFIX.length));
        const running = this.current;
        if (!running || ende.id !== running.id) return;
        if (ende.ok) {
          running.resolve();
        } else {
          running.reject(
            running.lastError ?? {
              kind: "PipelineFailed",
              detail: "Auftrag fehlgeschlagen ohne Fehlermeldung.",
            },
          );
        }
      } catch {
        // See above.
      }
    }
    // Anything else is torch/demucs log noise - same policy as runPipeline.
  }

  private startIdleTimer(): void {
    this.stopIdleTimer();
    if (!this.child) return;
    const setTimer = this.opts.setTimer ?? setTimeout;
    this.idleTimer = setTimer(() => {
      void this.shutdown();
    }, this.opts.idleMs ?? 300_000);
  }

  private stopIdleTimer(): void {
    if (this.idleTimer === null) return;
    const clearTimer =
      this.opts.clearTimer ??
      ((t: unknown) => clearTimeout(t as Parameters<typeof clearTimeout>[0]));
    clearTimer(this.idleTimer);
    this.idleTimer = null;
  }
}
