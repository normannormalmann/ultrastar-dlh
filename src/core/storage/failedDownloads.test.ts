import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  appendFailedDownload,
  loadFailedDownloads,
} from "./failedDownloads.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "ultrastar-failed-"));
  dirs.push(dir);
  return dir;
};

test("returns empty array when no json file exists", async () => {
  const dir = await tempDir();
  expect(await Effect.runPromise(loadFailedDownloads(dir))).toEqual([]);
});

test("append then load round-trips a single entry", async () => {
  const dir = await tempDir();
  const song = { apiId: 42, artist: "Artist", title: "Title" };
  await Effect.runPromise(appendFailedDownload(dir, song, "boom"));

  const entries = await Effect.runPromise(loadFailedDownloads(dir));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    apiId: 42,
    artist: "Artist",
    title: "Title",
    error: "boom",
  });
  expect(entries[0]?.usdbUrl).toContain("id=42");
  expect(typeof entries[0]?.timestamp).toBe("string");
});

test("multiple appends accumulate in the json file", async () => {
  const dir = await tempDir();
  await Effect.runPromise(
    appendFailedDownload(dir, { apiId: 1, artist: "A", title: "One" }, "err1"),
  );
  await Effect.runPromise(
    appendFailedDownload(dir, { apiId: 2, artist: "B", title: "Two" }, "err2"),
  );

  const entries = await Effect.runPromise(loadFailedDownloads(dir));
  expect(entries).toHaveLength(2);
  expect(entries.map((e) => e.apiId).sort()).toEqual([1, 2]);
});
