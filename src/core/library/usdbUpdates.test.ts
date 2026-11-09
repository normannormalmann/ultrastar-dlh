import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  applyUsdbCandidate,
  mergeUsdbText,
  remoteRevision,
  revisionOf,
  checkUsdbSong,
  musicalRevision,
  sourceSnapshot,
} from "./usdbUpdates.ts";
import { parseLyrics } from "../api/usdb/lyrics.ts";

const remote = parseLyrics(
  "<textarea>#ARTIST:A\n#TITLE:Part 1: Finale\n#BPM:120\n#MP3:remote.mp3\n: 0 4 12 A\nE\n</textarea>",
)!;
test("USDB merge preserves local media and colon-containing headers", () => {
  expect(remote.headers.title).toBe("Part 1: Finale");
  const text = mergeUsdbText(
    "#ARTIST:A\n#TITLE:B\n#MP3:local.mp4\n#VIDEO:local.mp4\n#BPM:100\n: 0 2 2 A\nE\n",
    remote,
  );
  expect(text).toContain("#MP3:local.mp4");
  expect(text).toContain("#VIDEO:local.mp4");
  expect(text).toContain("#BPM:120");
  expect(text).toContain(": 0 4 12 A");
});

test("first comparison normalizes media, records identical songs, and respects keep-local", async () => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-first-"));
  try {
    const local = mergeUsdbText(
      "#MP3:mine.mp4\n#BPM:120\n: 0 4 12 A\nE\n",
      remote,
    );
    await writeFile(join(root, "song.txt"), local);
    const fetchLyrics = () => Effect.succeed(remote);
    const first = await Effect.runPromise(
      checkUsdbSong(root, 1, "", fetchLyrics),
    );
    expect(first.changed).toBe(false);
    const baseline = JSON.parse(
      await readFile(join(root, "usdbSource.json"), "utf8"),
    );
    expect(baseline.remoteText).toContain("#MP3:remote.mp3");
    expect(
      musicalRevision(
        local.replace("#BPM:120", "#BPM:120,0").replaceAll("\n", "\r\n"),
      ),
    ).toBe(musicalRevision(local));
    await writeFile(
      join(root, "song.txt"),
      local.replace(": 0 4 12 A", ": 0 4 15 A"),
    );
    const newer = {
      ...remote,
      lyrics: remote.lyrics.replace(": 0 4 12 A", ": 0 4 14 A"),
    };
    const check = await Effect.runPromise(
      checkUsdbSong(root, 1, "", () => Effect.succeed(newer)),
    );
    expect(check.changed).toBe(true);
    expect(check.conflict).toBe(true);
    const before = await readFile(join(root, "song.txt"), "utf8");
    await Effect.runPromise(applyUsdbCandidate(root, check.candidate, true));
    expect(await readFile(join(root, "song.txt"), "utf8")).toBe(before);
    expect((await readdir(root)).some((name) => name.endsWith(".bak"))).toBe(
      false,
    );
    expect(
      (
        await Effect.runPromise(
          checkUsdbSong(root, 1, "", () => Effect.succeed(newer)),
        )
      ).changed,
    ).toBe(false);
    await writeFile(
      join(root, "usdbSource.json"),
      JSON.stringify(sourceSnapshot(999, remote)),
    );
    expect(
      (await Effect.runPromise(checkUsdbSong(root, 1, "", fetchLyrics)))
        .changed,
    ).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("USDB apply refuses stale revisions and backs up the actual previous bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-update-"));
  try {
    const path = join(root, "song.txt");
    await writeFile(path, "original");
    const candidate = {
      apiId: 1,
      text: "replacement",
      localRevision: revisionOf("original"),
      remoteRevision: remoteRevision(remote),
    };
    await writeFile(path, "edited");
    expect(
      await Effect.runPromise(
        Effect.either(applyUsdbCandidate(root, candidate)),
      ),
    ).toHaveProperty("_tag", "Left");
    expect(await readFile(path, "utf8")).toBe("edited");
    await Effect.runPromise(
      applyUsdbCandidate(root, {
        ...candidate,
        localRevision: revisionOf("edited"),
      }),
    );
    expect(await readFile(path, "utf8")).toBe("replacement");
    const backup = (await readdir(root)).find((file) => file.endsWith(".bak"))!;
    expect(await readFile(join(root, backup), "utf8")).toBe("edited");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
