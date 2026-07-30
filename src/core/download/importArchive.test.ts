import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  loadDownloadedEntries,
  saveDownloadedEntries,
} from "../storage/downloaded.ts";
import { getCacheDir } from "../storage/paths.ts";
import { importArchive } from "./importArchive.ts";

// Isoliertes Datenverzeichnis (gleiche Technik wie queue.test.ts)
process.env.ULTRASTAR_APP_NAME = `ultrastar-cli-import-test-${process.pid}`;

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  const cache = await Effect.runPromise(getCacheDir());
  await rm(join(cache, ".."), { recursive: true, force: true });
});

const makeArchive = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-archive-"));
  dirs.push(root);
  return root;
};

const makeSong = async (
  root: string,
  dirName: string,
  opts: { txt?: string | null; video?: boolean },
): Promise<void> => {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });
  if (opts.txt !== null) {
    await writeFile(
      join(dir, "song.txt"),
      opts.txt ?? `#ARTIST:${dirName}-Artist\n#TITLE:${dirName}-Title\n`,
      "utf8",
    );
  }
  if (opts.video) {
    await writeFile(join(dir, "video.mp4"), "fake-video-bytes", "utf8");
  }
};

test("imports songs, counts missing videos, skips tracked, ignores non-song folders", async () => {
  const root = await makeArchive();
  await makeSong(root, "ABBA - Waterloo", { video: true });
  await makeSong(root, "Toto - Africa", { video: false });
  await makeSong(root, "Kein Song", { txt: null, video: false });
  await makeSong(root, "Bereits Da", { video: true });

  // Mark "Bereits Da" as already tracked upfront
  await Effect.runPromise(
    saveDownloadedEntries([
      {
        apiId: -1,
        artist: "x",
        title: "y",
        dirName: "Bereits Da",
        songDir: join(root, "Bereits Da"),
        downloadedAt: "2026-01-01T00:00:00.000Z",
        language: "x",
      },
    ]),
  );

  const result = await Effect.runPromise(importArchive(root));
  expect(result).toEqual({
    imported: 2,
    importedWithoutVideo: 1,
    skipped: 1,
    refreshed: 0,
  });

  const entries = await Effect.runPromise(loadDownloadedEntries);
  expect(entries).toHaveLength(3);
  const abba = entries.find((e) => e.dirName === "ABBA - Waterloo");
  expect(abba?.artist).toBe("ABBA - Waterloo-Artist");
  expect(abba?.title).toBe("ABBA - Waterloo-Title");
  expect(abba?.apiId).toBeLessThan(0);
  expect(abba?.songDir).toBe(join(root, "ABBA - Waterloo"));
});

test("falls back to folder name when headers are missing", async () => {
  const root = await makeArchive();
  await makeSong(root, "Nur Noten", { txt: ": 0 4 0 La\n", video: true });

  const result = await Effect.runPromise(importArchive(root));
  expect(result.imported).toBe(1);
  const entries = await Effect.runPromise(loadDownloadedEntries);
  const e = entries.find((x) => x.dirName === "Nur Noten");
  expect(e?.artist).toBe("Nur Noten");
  expect(e?.title).toBe("Nur Noten");
});

test("fails with Error when the directory does not exist", async () => {
  await expect(
    Effect.runPromise(importArchive(join(tmpdir(), "does-not-exist-xyz"))),
  ).rejects.toThrow();
});

test("reports progress and finishes with current === total", async () => {
  const root = await makeArchive();
  await makeSong(root, "P1", { video: true });
  await makeSong(root, "P2", { video: true });
  await makeSong(root, "P3", { video: false });

  const calls: Array<{ current: number; total: number }> = [];
  await Effect.runPromise(importArchive(root, (p) => calls.push({ ...p })));

  expect(calls.length).toBeGreaterThan(0);
  const last = calls[calls.length - 1];
  expect(last?.total).toBe(3);
  expect(last?.current).toBe(3);
});

test("finds songs nested one level deep (artist/letter layouts)", async () => {
  const root = await makeArchive();
  await makeSong(root, "Flat_-_Song", { video: true });
  await makeSong(root, join("ABBA", "ABBA_-_Nested"), { video: true });
  await makeSong(root, join("A", "Deep", "Too_-_Deep"), { video: true }); // Tiefe 3 → ignoriert

  const result = await Effect.runPromise(importArchive(root));
  expect(result.imported).toBe(2);

  const entries = await Effect.runPromise(loadDownloadedEntries);
  const nested = entries.find((e) => e.dirName === "ABBA_-_Nested");
  expect(nested?.songDir).toBe(join(root, "ABBA", "ABBA_-_Nested"));
  expect(entries.find((e) => e.dirName === "Too_-_Deep")).toBeUndefined();
});

test("stores metadata and backfills tracked entries missing language", async () => {
  const root = await makeArchive();
  await makeSong(root, "Meta Song", {
    txt: "#ARTIST:Meta\n#TITLE:Song\n#LANGUAGE:German\n#GENRE:Pop\n#YEAR:1999\n",
    video: true,
  });
  await makeSong(root, "Old Tracked", {
    txt: "#ARTIST:Old\n#TITLE:Tracked\n#LANGUAGE:English\n",
    video: true,
  });
  await Effect.runPromise(
    saveDownloadedEntries([
      {
        apiId: -5,
        artist: "Old",
        title: "Tracked",
        dirName: "Old Tracked",
        songDir: join(root, "Old Tracked"),
        downloadedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
  );

  const result = await Effect.runPromise(importArchive(root));
  expect(result.imported).toBe(1);
  expect(result.refreshed).toBe(1);
  expect(result.skipped).toBe(0);

  const entries = await Effect.runPromise(loadDownloadedEntries);
  const meta = entries.find((e) => e.dirName === "Meta Song");
  expect(meta?.language).toBe("German");
  expect(meta?.genre).toBe("Pop");
  expect(meta?.year).toBe(1999);
  const old = entries.find((e) => e.dirName === "Old Tracked");
  expect(old?.language).toBe("English");
  expect(old?.artist).toBe("Old"); // existing fields are not overwritten
});
