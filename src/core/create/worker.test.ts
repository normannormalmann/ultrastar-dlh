// src/core/create/worker.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { SidecarWorker } from "./worker.ts";

/** Stand-in worker: speaks the same marker protocol as worker.py. */
const FAKE = `
console.log("@@READY");
const dec = new TextDecoder();
let puffer = "";
for await (const chunk of Bun.stdin.stream()) {
  puffer += dec.decode(chunk);
  const zeilen = puffer.split("\\n");
  puffer = zeilen.pop() ?? "";
  for (const zeile of zeilen) {
    if (!zeile.trim()) continue;
    const job = JSON.parse(zeile);
    console.log('@@PROGRESS {"stage":"separate","percent":0.5}');
    if (job.id === "fail") {
      console.log('@@ERROR {"kind":"alignment_failed","detail":"kaputt"}');
      console.log("@@JOB " + JSON.stringify({ id: job.id, ok: false }));
    } else if (job.id === "crash") {
      process.exit(3);
    } else if (job.id === "slow") {
      await new Promise((r) => setTimeout(r, 5000));
      console.log("@@JOB " + JSON.stringify({ id: job.id, ok: true }));
    } else {
      console.log("@@JOB " + JSON.stringify({ id: job.id, ok: true }));
    }
  }
}
`;

const fakeWorkerBin = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "worker-test-"));
  const skript = join(dir, "fakeWorker.ts");
  await writeFile(skript, FAKE, "utf8");
  return skript;
};

const job = (id: string) => ({
  id,
  audioPath: "a.wav",
  lyricsPath: "l.txt",
  language: "de",
  outPath: "o.json",
});

describe("SidecarWorker", () => {
  it("verarbeitet einen Job und meldet Fortschritt", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    const stufen: string[] = [];
    await worker.submitJob(job("ok1"), (stage) => stufen.push(stage));
    expect(stufen).toContain("separate");
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("haelt den Worker fuer den zweiten Job warm", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    await worker.submitJob(job("ok1"));
    const nachErstem = worker.isAlive();
    await worker.submitJob(job("ok2"));
    expect(nachErstem).toBe(true);
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("mappt @@ERROR auf typisierte Fehler und ueberlebt sie", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    await expect(worker.submitJob(job("fail"))).rejects.toMatchObject({
      kind: "AlignmentFailed",
    });
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("meldet einen Crash als PipelineFailed und startet danach neu", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    await expect(worker.submitJob(job("crash"))).rejects.toMatchObject({
      kind: "PipelineFailed",
    });
    expect(worker.isAlive()).toBe(false);
    await worker.submitJob(job("ok2"));
    expect(worker.isAlive()).toBe(true);
    await worker.shutdown();
  });

  it("cancelCurrentJob bricht den laufenden Job ab und toetet den Worker", async () => {
    const worker = new SidecarWorker({ pythonBin: await fakeWorkerBin() });
    const laufend = worker.submitJob(job("slow"));
    await new Promise((r) => setTimeout(r, 400));
    worker.cancelCurrentJob();
    await expect(laufend).rejects.toMatchObject({ kind: "Cancelled" });
    expect(worker.isAlive()).toBe(false);
  });

  it("faehrt nach dem Idle-Timeout herunter", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const worker = new SidecarWorker({
      pythonBin: await fakeWorkerBin(),
      idleMs: 12345,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => {},
    });
    await worker.submitJob(job("ok3"));
    const idle = timers.find((t) => t.ms === 12345);
    expect(idle).toBeDefined();
    idle?.fn();
    await new Promise((r) => setTimeout(r, 600));
    expect(worker.isAlive()).toBe(false);
  });
});
