import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { getCacheDir, resolveDataFilePath } from "./paths.ts";
import { loadQueue, saveQueue } from "./queue.ts";

const appName = `ultrastar-cli-test-${process.pid}`;
let previousAppName: string | undefined;

beforeEach(() => {
  previousAppName = process.env.ULTRASTAR_APP_NAME;
  process.env.ULTRASTAR_APP_NAME = appName;
});

afterEach(() => {
  if (previousAppName === undefined) delete process.env.ULTRASTAR_APP_NAME;
  else process.env.ULTRASTAR_APP_NAME = previousAppName;
});

afterAll(async () => {
  const dir = await Effect.runPromise(getCacheDir(appName));
  await rm(dir, { recursive: true, force: true });
});

test("resolveDataFilePath respects ULTRASTAR_APP_NAME and file name", async () => {
  const p = await Effect.runPromise(resolveDataFilePath("queue.json"));
  expect(p).toContain(`ultrastar-cli-test-${process.pid}`);
  expect(p.endsWith("queue.json")).toBe(true);
});

test("saveQueue then loadQueue round-trips songs", async () => {
  const songs = [
    { apiId: 1, artist: "ABBA", title: "Waterloo", languages: ["english"] },
    { apiId: 2, artist: "Toto", title: "Africa", languages: ["english"] },
  ];
  await Effect.runPromise(saveQueue(songs));
  const loaded = await Effect.runPromise(loadQueue);
  expect(loaded).toEqual(songs);
});

test("loadQueue returns empty array when file is missing", async () => {
  const dir = await Effect.runPromise(getCacheDir(appName));
  await rm(dir, { recursive: true, force: true });
  const loaded = await Effect.runPromise(loadQueue);
  expect(loaded).toEqual([]);
});

test("loadQueue returns empty array for corrupt JSON", async () => {
  const p = await Effect.runPromise(resolveDataFilePath("queue.json"));
  await Bun.write(p, "{not json");
  const loaded = await Effect.runPromise(loadQueue);
  expect(loaded).toEqual([]);
});
