import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { inspectLibrary, safeSongFile } from "./inspect.ts";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
test("recursively validates audio songs, separates duet tracks, and reports duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-inspect-"));
  roots.push(root);
  for (const folder of ["A/Artist/One", "Artist/Two"]) {
    const dir = join(root, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "audio.mp3"), "audio");
    await writeFile(
      join(dir, "song.txt"),
      "#ARTIST:Test Artist\n#TITLE:The Song\n#BPM:120\n#MP3:audio.mp3\nP1\n: 0 4 12 Hello\nP2\n: 0 4 15 Hello\nE\n",
    );
  }
  const good = await Effect.runPromise(inspectLibrary(root));
  expect(good.scanned).toBe(2);
  expect(good.issues).toEqual([]);
  expect(good.duplicates[0]?.length).toBe(2);
  await writeFile(
    join(root, "Artist/Two/song.txt"),
    "#ARTIST:Test Artist\n#TITLE:The Song\n#BPM:0\n#AUDIO:missing.mp3\n: 0 4 12 Hello\n: 3 2 14 world\n",
  );
  const bad = await Effect.runPromise(inspectLibrary(root));
  expect(bad.issues.map((issue) => issue.message).join(" ")).toContain(
    "Abschlussmarkierung E",
  );
  expect(
    bad.issues.some((issue) => issue.message.includes("Überlappung")),
  ).toBe(true);
  expect(bad.issues.some((issue) => issue.message.includes("BPM"))).toBe(true);
  expect(
    bad.issues.some((issue) => issue.message.includes("missing.mp3")),
  ).toBe(true);
  expect(
    await safeSongFile(
      join(root, "Artist/Two"),
      "../../A/Artist/One/audio.mp3",
    ),
  ).toBeNull();
});
