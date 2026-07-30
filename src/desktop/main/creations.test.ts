// src/desktop/main/creations.test.ts
import { describe, expect, it } from "bun:test";
import { createCreations, type CreationsDeps } from "./creations.ts";

type FakeVerhalten = "ok" | "fail" | "crash";

const fakeDeps = (opts?: {
  env?: "ready" | "missing" | "outdated";
  verhalten?: (id: string) => FakeVerhalten;
}) => {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const bearbeitet: string[] = [];
  let alive = false;
  const worker = {
    isAlive: () => alive,
    submitJob: async (job: { id: string }) => {
      alive = true;
      bearbeitet.push(job.id);
      const v = opts?.verhalten?.(job.id) ?? "ok";
      if (v === "fail") throw { kind: "AlignmentFailed", detail: "kaputt" };
      if (v === "crash") {
        alive = false;
        throw { kind: "PipelineFailed", detail: "Worker beendet (Exit 3)." };
      }
    },
    cancelCurrentJob: () => {
      alive = false;
    },
    shutdown: async () => {
      alive = false;
    },
  };
  const deps = {
    newWorker: () => worker,
    environmentStatus: async () => ({ state: opts?.env ?? "ready" }),
    broadcast: (channel: string, payload: unknown) =>
      events.push({ channel, payload }),
  } as unknown as CreationsDeps;
  return { deps, events, bearbeitet };
};

const job = (id: string) => ({
  id,
  audioPath: "a.wav",
  lyricsPath: "l.txt",
  language: "de",
  outPath: `${id}.json`,
});

describe("creation queue", () => {
  it("verarbeitet Jobs sequenziell und meldet Status", async () => {
    const { deps, events, bearbeitet } = fakeDeps();
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    await c.start();
    expect(bearbeitet).toEqual(["a", "b"]);
    const letzter = events.filter((e) => e.channel === "event:creations").at(-1)
      ?.payload as Array<{ status: string }>;
    expect(letzter.map((e) => e.status)).toEqual(["completed", "completed"]);
  });

  it("ein fachlicher Fehler stoppt die Queue nicht", async () => {
    const { deps, bearbeitet } = fakeDeps({
      verhalten: (id) => (id === "a" ? "fail" : "ok"),
    });
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    await c.start();
    expect(bearbeitet).toEqual(["a", "b"]);
    const eintraege = c.entriesForTests();
    expect(eintraege.find((e) => e.id === "a")?.status).toBe("failed");
    expect(eintraege.find((e) => e.id === "a")?.error).toBe("kaputt");
    expect(eintraege.find((e) => e.id === "b")?.status).toBe("completed");
  });

  it("drei Crashs in Folge pausieren die Queue", async () => {
    const { deps, events, bearbeitet } = fakeDeps({ verhalten: () => "crash" });
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b"), job("c"), job("d")]);
    await c.start();
    expect(bearbeitet).toEqual(["a", "b", "c"]);
    expect(
      events.some(
        (e) =>
          e.channel === "event:error" &&
          String((e.payload as { message: string }).message).includes("pausiert"),
      ),
    ).toBe(true);
    expect(c.entriesForTests().find((e) => e.id === "d")?.status).toBe("queued");
  });

  it("blockiert ohne eingerichtete Umgebung", async () => {
    const { deps, events, bearbeitet } = fakeDeps({ env: "missing" });
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    expect(bearbeitet).toEqual([]);
    expect(events.some((e) => e.channel === "event:error")).toBe(true);
  });

  it("outdated laeuft mit Warnung weiter", async () => {
    const { deps, events, bearbeitet } = fakeDeps({ env: "outdated" });
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    expect(bearbeitet).toEqual(["a"]);
    expect(
      events.some(
        (e) =>
          e.channel === "event:error" &&
          String((e.payload as { message: string }).message).includes("veraltet"),
      ),
    ).toBe(true);
  });

  it("queueRemove entfernt nur wartende Jobs", async () => {
    const { deps } = fakeDeps();
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    c.queueRemove("b");
    expect(c.entriesForTests().map((e) => e.id)).toEqual(["a"]);
  });

  it("meldet Fortschritt des laufenden Jobs", async () => {
    const events: Array<{ channel: string; payload: unknown }> = [];
    const deps = {
      newWorker: () => ({
        isAlive: () => true,
        submitJob: async (
          _job: { id: string },
          onProgress?: (stage: string, percent: number) => void,
        ) => {
          onProgress?.("separate", 0.5);
        },
        cancelCurrentJob: () => {},
        shutdown: async () => {},
      }),
      environmentStatus: async () => ({ state: "ready" }),
      broadcast: (channel: string, payload: unknown) =>
        events.push({ channel, payload }),
    } as unknown as CreationsDeps;
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    const mitStufe = events
      .filter((e) => e.channel === "event:creations")
      .flatMap((e) => e.payload as Array<{ stage?: string }>)
      .some((e) => e.stage === "separate");
    expect(mitStufe).toBe(true);
  });
});
