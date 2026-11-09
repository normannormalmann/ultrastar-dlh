import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { analyzeOriginalVocal } from "./vocalAnalysis.ts";

test("vocal analysis preserves edits, caches matching sources, and leaves valid artifacts after cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "vocal-analysis-"));
  const controller = new AbortController();
  let calls = 0;
  try {
    const audio = join(root, "audio.wav");
    await writeFile(audio, "audio");
    await writeFile(join(root, "song.txt"), "user edits");
    const run = async (_command: string, args: string[]) => {
      calls++;
      const outIndex = args.indexOf("--out");
      if (outIndex < 0) return;
      const out = args[outIndex + 1]!;
      await writeFile(join(out, "vocals.wav"), "RIFFvoice");
      await writeFile(
        join(out, "originalPitch.json"),
        JSON.stringify({ midiOffset: 60, points: [{ ms: 10, pitch: 2 }] }),
      );
    };
    const options = {
      songDir: root,
      audioPath: audio,
      python: "python",
      workDir: join(root, "work"),
      analysisVersion: "v1",
      midiOffset: 60 as const,
      signal: controller.signal,
      run,
    };
    const first = await Effect.runPromise(analyzeOriginalVocal(options));
    expect(first.vocalFile).toMatch(/^vocals-/);
    expect(await readFile(join(root, "song.txt"), "utf8")).toBe("user edits");
    await Effect.runPromise(analyzeOriginalVocal(options));
    expect(calls).toBe(2);
    await writeFile(audio, "changed audio");
    await Effect.runPromise(analyzeOriginalVocal(options));
    expect(calls).toBe(4);
    const committed = await readFile(join(root, "originalPitch.json"), "utf8");
    const cancelled = analyzeOriginalVocal({
      ...options,
      analysisVersion: "v2",
      run: async (command, args) => {
        await run(command, args);
        controller.abort();
      },
    });
    expect((await Effect.runPromise(Effect.either(cancelled)))._tag).toBe(
      "Left",
    );
    expect(await readFile(join(root, "originalPitch.json"), "utf8")).toBe(
      committed,
    );
    expect(
      (await readdir(join(root, "work"))).filter((name) =>
        name.startsWith("analysis-"),
      ),
    ).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
