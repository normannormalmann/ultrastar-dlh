import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { CreateJob } from "../create/job.ts";
import { loadCreateQueue, saveCreateQueue } from "./createQueue.ts";
import { resolveDataFilePath } from "./paths.ts";

const zuvor = process.env.ULTRASTAR_APP_NAME;

const job = (id: string): CreateJob => ({
  id,
  quelle: { kind: "youtube", url: `https://youtu.be/${id}` },
  language: "Deutsch",
  artist: "Falco",
  title: "Rock Me Amadeus",
  lyricsText: "Er war ein Punker",
});

beforeEach(() => {
  // env-paths derives the cache dir from the app name; a unique name per test
  // keeps the real user cache untouched.
  process.env.ULTRASTAR_APP_NAME = `ultrastar-test-${Date.now()}-${Math.round(
    Math.random() * 1e6,
  )}`;
});

afterEach(() => {
  process.env.ULTRASTAR_APP_NAME = zuvor;
});

describe("createQueue", () => {
  it("liefert eine leere Queue, wenn keine Datei existiert", async () => {
    expect(await Effect.runPromise(loadCreateQueue)).toEqual([]);
  });

  it("speichert und liest zurueck", async () => {
    const jobs = [job("a"), job("b")];
    await Effect.runPromise(saveCreateQueue(jobs));
    expect(await Effect.runPromise(loadCreateQueue)).toEqual(jobs);
  });

  it("liefert eine leere Queue bei kaputtem JSON", async () => {
    await Effect.runPromise(saveCreateQueue([job("a")]));
    const datei = await Effect.runPromise(
      resolveDataFilePath("create-queue.json"),
    );
    await writeFile(datei, "{kein json");
    expect(await Effect.runPromise(loadCreateQueue)).toEqual([]);
  });
});
