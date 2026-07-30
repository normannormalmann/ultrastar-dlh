import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import { getCacheDir, resolveDataFilePath } from "./paths.ts";
import { loadQueue, saveQueue } from "./queue.ts";

// Isolated cache directory per test run; getAppName() reads the variable
// on every call, so setting it before the first Effect run is sufficient.
process.env.ULTRASTAR_APP_NAME = `ultrastar-cli-test-${process.pid}`;

afterAll(async () => {
  // Delete the parent directory (…\ultrastar-cli-test-<pid>), not just the cache leaf
  const dir = await Effect.runPromise(getCacheDir());
  await rm(join(dir, ".."), { recursive: true, force: true });
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
  const dir = await Effect.runPromise(getCacheDir());
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
