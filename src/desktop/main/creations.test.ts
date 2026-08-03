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
    workDir: () => "C:/userData/pipeline-cache",
    jobDir: (id: string) => `C:/userData/jobs/${id}`,
    libraryDir: () => "C:/library",
    layout: () => "flat",
    acquire: async () => ({ audioPath: "a.m4a", videoPath: "v.mp4" }),
    assemble: async () => ({
      songDir: "C:/library/Interpret - Titel",
      dirName: "Interpret - Titel",
      warnungen: [],
    }),
    aufraeumen: async () => {},
    broadcast: (channel: string, payload: unknown) =>
      events.push({ channel, payload }),
  } as unknown as CreationsDeps;
  return { deps, events, bearbeitet };
};

const job = (id: string) => ({
  id,
  quelle: { kind: "youtube" as const, url: `https://youtu.be/${id}` },
  language: "de",
  artist: "Interpret",
  title: id,
  lyricsPath: "l.txt",
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

  it("blockiert bei veralteter Umgebung", async () => {
    // Der Inhalts-Hash macht "outdated" scharf: der installierte Sidecar
    // kann das Worker-Protokoll noch gar nicht kennen. Loslaufen hiesse
    // drei READY-Timeouts a 120 s abzubrennen.
    const { deps, events, bearbeitet } = fakeDeps({ env: "outdated" });
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    expect(bearbeitet).toEqual([]);
    expect(
      events.some(
        (e) =>
          e.channel === "event:error" &&
          String((e.payload as { message: string }).message).includes("veraltet"),
      ),
    ).toBe(true);
    expect(c.entriesForTests()[0]?.status).toBe("queued");
  });

  it("reicht ein beschreibbares workDir an den Worker durch", async () => {
    const gesehen: Array<string | undefined> = [];
    const deps = {
      newWorker: () => ({
        isAlive: () => true,
        submitJob: async (j: { workDir?: string }) => {
          gesehen.push(j.workDir);
        },
        cancelCurrentJob: () => {},
        shutdown: async () => {},
      }),
      environmentStatus: async () => ({ state: "ready" }),
      workDir: () => "C:/userData/pipeline-cache",
      jobDir: (id: string) => `C:/userData/jobs/${id}`,
      libraryDir: () => "C:/library",
      layout: () => "flat",
      acquire: async () => ({ audioPath: "a.m4a", videoPath: "v.mp4" }),
      assemble: async () => ({
        songDir: "C:/library/x",
        dirName: "x",
        warnungen: [],
      }),
      aufraeumen: async () => {},
      broadcast: () => {},
    } as unknown as CreationsDeps;
    const c = createCreations(deps);
    c.queueAdd([job("a")]);
    await c.start();
    expect(gesehen).toEqual(["C:/userData/pipeline-cache"]);
  });

  it("queueRemove entfernt nur wartende Jobs", async () => {
    const { deps } = fakeDeps();
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    c.queueRemove("b");
    expect(c.entriesForTests().map((e) => e.id)).toEqual(["a"]);
  });

  it("Abbruch beendet nur den laufenden Job, die Queue laeuft weiter", async () => {
    const bearbeitet: string[] = [];
    let alive = false;
    let rejectLaufend: ((fehler: unknown) => void) | null = null;
    // Signals that "a" really sits in the worker. Since acquisition now runs
    // first, a fixed number of microtask ticks would cancel too early - the
    // job would not be in the worker yet and nothing would reject it.
    let jobLaeuft: (() => void) | null = null;
    const laeuft = new Promise<void>((res) => {
      jobLaeuft = res;
    });
    const worker = {
      isAlive: () => alive,
      submitJob: (j: { id: string }) => {
        bearbeitet.push(j.id);
        alive = true;
        if (j.id !== "a") return Promise.resolve();
        jobLaeuft?.();
        // "a" haengt, bis cancelCurrentJob es abweist - wie der echte Worker.
        return new Promise<void>((_res, rej) => {
          rejectLaufend = rej;
        });
      },
      cancelCurrentJob: () => {
        alive = false;
        rejectLaufend?.({ kind: "Cancelled" });
        rejectLaufend = null;
      },
      shutdown: async () => {
        alive = false;
      },
    };
    const deps = {
      newWorker: () => worker,
      environmentStatus: async () => ({ state: "ready" }),
      workDir: () => "C:/userData/pipeline-cache",
      jobDir: (id: string) => `C:/userData/jobs/${id}`,
      libraryDir: () => "C:/library",
      layout: () => "flat",
      acquire: async () => ({ audioPath: "a.m4a", videoPath: "v.mp4" }),
      assemble: async () => ({
        songDir: "C:/library/x",
        dirName: "x",
        warnungen: [],
      }),
      aufraeumen: async () => {},
      broadcast: () => {},
    } as unknown as CreationsDeps;

    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    const laufend = c.start();
    await laeuft;
    c.cancel();
    await laufend;
    expect(bearbeitet).toEqual(["a", "b"]);
    const eintraege = c.entriesForTests();
    // Ein Abbruch ist eine Nutzerentscheidung, kein Fehlschlag.
    expect(eintraege.find((e) => e.id === "a")?.status).toBe("cancelled");
    expect(eintraege.find((e) => e.id === "b")?.status).toBe("completed");
  });

  it("zweimal start() laesst keinen Job durch die Umgebungspruefung schluepfen", async () => {
    const { deps, bearbeitet } = fakeDeps();
    const c = createCreations(deps);
    c.queueAdd([job("a"), job("b")]);
    await Promise.all([c.start(), c.start()]);
    expect(bearbeitet).toEqual(["a", "b"]);
    expect(c.entriesForTests().map((e) => e.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("durchlaeuft Beschaffung, Pipeline und Paketbau in dieser Reihenfolge", async () => {
    const ablauf: string[] = [];
    const { deps } = fakeDeps();
    const erweitert = {
      ...deps,
      acquire: async () => {
        ablauf.push("beschaffen");
        return { audioPath: "a.m4a", videoPath: "v.mp4" };
      },
      assemble: async () => {
        ablauf.push("paket");
        return { songDir: "C:/library/x", dirName: "x", warnungen: [] };
      },
      newWorker: () => ({
        isAlive: () => true,
        submitJob: async () => {
          ablauf.push("pipeline");
        },
        cancelCurrentJob: () => {},
        shutdown: async () => {},
      }),
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a")]);
    await c.start();
    expect(ablauf).toEqual(["beschaffen", "pipeline", "paket"]);
    expect(c.entriesForTests()[0]?.status).toBe("completed");
  });

  it("eine gescheiterte Beschaffung stoppt die Queue nicht", async () => {
    const { deps } = fakeDeps();
    const versucht: string[] = [];
    const erweitert = {
      ...deps,
      acquire: async (j: { id: string }) => {
        versucht.push(j.id);
        if (j.id === "a") throw { kind: "DownloadFailed", detail: "kaputt" };
        return { audioPath: "a.m4a" };
      },
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a"), job("b")]);
    await c.start();
    expect(versucht).toEqual(["a", "b"]);
    const eintraege = c.entriesForTests();
    expect(eintraege.find((e) => e.id === "a")?.status).toBe("failed");
    expect(eintraege.find((e) => e.id === "a")?.error).toBe("kaputt");
    expect(eintraege.find((e) => e.id === "b")?.status).toBe("completed");
  });

  it("Abbruch waehrend der Beschaffung stoppt den Job", async () => {
    const { deps } = fakeDeps();
    let abgebrochen = false;
    const erweitert = {
      ...deps,
      acquire: (_j: unknown, _d: string, _p: unknown, signal: AbortSignal) =>
        new Promise((_res, rej) => {
          signal.addEventListener("abort", () => {
            abgebrochen = true;
            rej({ kind: "Cancelled", detail: "" });
          });
        }),
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a")]);
    const laufend = c.start();
    await Promise.resolve();
    c.cancel();
    await laufend;
    expect(abgebrochen).toBe(true);
    expect(c.entriesForTests()[0]?.status).toBe("cancelled");
  });

  it("raeumt das Kratzverzeichnis nach Erfolg weg, nach einem Fehler nicht", async () => {
    const geraeumt: string[] = [];
    const { deps } = fakeDeps({ verhalten: (id) => (id === "b" ? "fail" : "ok") });
    const erweitert = {
      ...deps,
      aufraeumen: async (d: string) => {
        geraeumt.push(d);
      },
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a"), job("b")]);
    await c.start();
    expect(geraeumt).toEqual(["C:/userData/jobs/a"]);
  });

  it("ein fehlgeschlagenes Aufraeumen macht aus einem fertigen Song keinen Fehler", async () => {
    const { deps } = fakeDeps();
    const erweitert = {
      ...deps,
      aufraeumen: async () => {
        // Windows haelt gern noch ein Handle auf das Kratzverzeichnis.
        throw new Error("EBUSY");
      },
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a")]);
    await c.start();
    expect(c.entriesForTests()[0]?.status).toBe("completed");
  });

  it("ein Abbruch in der Beschaffung behaelt den warmen Worker", async () => {
    const { deps } = fakeDeps();
    let erzeugt = 0;
    const erweitert = {
      ...deps,
      newWorker: () => {
        erzeugt += 1;
        return {
          isAlive: () => true,
          submitJob: async () => {},
          cancelCurrentJob: () => {},
          shutdown: async () => {},
        };
      },
      acquire: (_j: unknown, _d: string, _p: unknown, signal: AbortSignal) =>
        new Promise((res, rej) => {
          if (signal.aborted) {
            rej({ kind: "Cancelled", detail: "" });
            return;
          }
          signal.addEventListener("abort", () =>
            rej({ kind: "Cancelled", detail: "" }),
          );
          setTimeout(() => res({ audioPath: "a.m4a" }), 0);
        }),
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a"), job("b")]);
    const laufend = c.start();
    await Promise.resolve();
    c.cancel();
    await laufend;
    // Der Worker hatte nie einen Auftrag - ihn wegzuwerfen wuerde den
    // naechsten Job einen vollen Kaltstart kosten.
    expect(erzeugt).toBe(1);
    expect(c.entriesForTests().find((e) => e.id === "a")?.status).toBe(
      "cancelled",
    );
  });

  it("shutdown bricht eine laufende Beschaffung ab", async () => {
    const { deps } = fakeDeps();
    let abgebrochen = false;
    const erweitert = {
      ...deps,
      acquire: (_j: unknown, _d: string, _p: unknown, signal: AbortSignal) =>
        new Promise((_res, rej) => {
          signal.addEventListener("abort", () => {
            abgebrochen = true;
            rej({ kind: "Cancelled", detail: "" });
          });
        }),
    } as unknown as CreationsDeps;
    const c = createCreations(erweitert);
    c.queueAdd([job("a")]);
    const laufend = c.start();
    await Promise.resolve();
    await c.shutdown();
    await laufend;
    expect(abgebrochen).toBe(true);
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
      workDir: () => "C:/userData/pipeline-cache",
      jobDir: (id: string) => `C:/userData/jobs/${id}`,
      libraryDir: () => "C:/library",
      layout: () => "flat",
      acquire: async () => ({ audioPath: "a.m4a", videoPath: "v.mp4" }),
      assemble: async () => ({
        songDir: "C:/library/x",
        dirName: "x",
        warnungen: [],
      }),
      aufraeumen: async () => {},
      // Snapshot: melde() broadcasts the live entry objects, so the later
      // "paket" stage would overwrite the "separate" we want to observe.
      broadcast: (channel: string, payload: unknown) =>
        events.push({ channel, payload: structuredClone(payload) }),
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
