import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  loadDownloadedEntries,
  saveDownloadedEntries,
} from "../storage/downloaded.ts";
import { getCacheDir } from "../storage/paths.ts";
import { enrichGenres } from "./enrichGenres.ts";

process.env.ULTRASTAR_APP_NAME = `ultrastar-cli-enrich-test-${process.pid}`;

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  const cache = await Effect.runPromise(getCacheDir());
  await rm(join(cache, ".."), { recursive: true, force: true });
});

const seed = async (n: number, withGenreEvery?: number) => {
  const root = await mkdtemp(join(tmpdir(), "enrich-"));
  dirs.push(root);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const dirName = `Song_${i}`;
    const songDir = join(root, dirName);
    await mkdir(songDir, { recursive: true });
    await writeFile(
      join(songDir, "song.txt"),
      `#ARTIST:A${i}\n#TITLE:T${i}\n: 0 4 0 La\n`,
      "utf8",
    );
    entries.push({
      apiId: -(i + 1),
      artist: `A${i}`,
      title: `T${i}`,
      dirName,
      songDir,
      downloadedAt: "2026-01-01T00:00:00.000Z",
      ...(withGenreEvery && i % withGenreEvery === 0 ? { genre: "Pop" } : {}),
    });
  }
  await Effect.runPromise(saveDownloadedEntries(entries));
  return root;
};

test("enriches missing genres, patches song.txt, fills year only when empty", async () => {
  await seed(4, 2); // Entries 0 and 2 already have a genre
  const result = await Effect.runPromise(
    enrichGenres(
      (artist) =>
        Effect.succeed(
          artist === "A3"
            ? null
            : { genre: "Rock", year: 1999, realBpm: 128, explicit: false },
        ),
      { minDelayMs: 0 },
    ),
  );
  expect(result).toMatchObject({
    processed: 2, // nur 1 und 3 (ohne Genre)
    enriched: 1, // A1
    notFound: 1, // A3
    txtPatched: 1,
    txtFailed: 0,
    cancelled: false,
  });
  const entries = await Effect.runPromise(loadDownloadedEntries);
  const e1 = entries.find((e) => e.artist === "A1");
  expect(e1?.genre).toBe("Rock");
  expect(e1?.year).toBe(1999);
  expect(e1?.realBpm).toBe(128);
  const txt = await readFile(join(e1!.songDir, "song.txt"), "utf8");
  expect(txt).toContain("#GENRE:Rock");
});

test("cancel stops between entries and persists progress", async () => {
  await seed(6);
  let calls = 0;
  const result = await Effect.runPromise(
    enrichGenres(() => Effect.succeed({ genre: "Pop" }), {
      minDelayMs: 0,
      persistEvery: 2,
      shouldCancel: () => calls++ >= 2,
    }),
  );
  expect(result.cancelled).toBe(true);
  expect(result.enriched).toBe(2);
  const entries = await Effect.runPromise(loadDownloadedEntries);
  expect(entries.filter((e) => e.genre === "Pop").length).toBe(2);
});

test("aborts after 5 consecutive hard errors", async () => {
  await seed(10);
  await expect(
    Effect.runPromise(
      enrichGenres(() => Effect.fail(new Error("boom")), { minDelayMs: 0 }),
    ),
  ).rejects.toThrow(/5 Fehler in Folge/);
});

test("persist merges with entries added concurrently (no lost update)", async () => {
  const root = await seed(3);
  let injected = false;
  const result = await Effect.runPromise(
    enrichGenres(
      (_artist) =>
        Effect.gen(function* () {
          if (!injected) {
            injected = true;
            // Simulates a concurrently completed download
            const current = yield* loadDownloadedEntries;
            yield* saveDownloadedEntries([
              {
                apiId: 4242,
                artist: "Concurrent",
                title: "Download",
                dirName: "Concurrent_-_Download",
                songDir: join(root, "Concurrent_-_Download"),
                downloadedAt: "2026-06-04T00:00:00.000Z",
                genre: "Pop",
              },
              ...current,
            ]);
          }
          return { genre: "Rock" };
        }),
      { minDelayMs: 0, persistEvery: 1 },
    ),
  );
  expect(result.enriched).toBe(3);
  const entries = await Effect.runPromise(loadDownloadedEntries);
  expect(entries.find((e) => e.apiId === 4242)).toBeDefined(); // survives persist!
  expect(entries.filter((e) => e.genre === "Rock")).toHaveLength(3);
});
