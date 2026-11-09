import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { atomicWrite, serializeFile } from "../storage/atomicFile.ts";
import {
  parseOriginalPitch,
  ORIGINAL_PITCH_FILE,
  type OriginalPitch,
} from "../edit/originalVocal.ts";
import { safeSongFile, pathKey } from "../library/inspect.ts";
import { killProcessTree } from "./processTree.ts";

export const audioHash = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const block of createReadStream(path)) hash.update(block);
  return hash.digest("hex");
};

export const runAnalysisCommand = (
  command: string,
  args: string[],
  signal: AbortSignal,
  progress?: (stage: string, percent: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Analyse abgebrochen."));
      return;
    }
    const child = spawn(command, args, {
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    let rest = "";
    let timedOut = false;
    const cancel = () => {
      killProcessTree(child);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, 30 * 60_000);
    signal.addEventListener("abort", cancel, { once: true });
    child.stderr.on("data", (data) => {
      tail = (tail + data).slice(-2000);
    });
    child.stdout.on("data", (data) => {
      rest = (rest + data).slice(-8192);
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines)
        if (line.startsWith("@@PROGRESS ")) {
          try {
            const p = JSON.parse(line.slice(11));
            progress?.(String(p.stage), Number(p.percent));
          } catch {
            /* Ignore malformed progress messages. */
          }
        }
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (signal.aborted) reject(new Error("Analyse abgebrochen."));
      else if (timedOut)
        reject(
          new Error("Analyse hat das Zeitlimit von 30 Minuten überschritten."),
        );
      else if (code !== 0) reject(new Error(`Analyse fehlgeschlagen: ${tail}`));
      else resolve();
    });
    if (signal.aborted) cancel();
  });

export const analyzeOriginalVocal = (opts: {
  songDir: string;
  audioPath: string;
  python: string;
  workDir: string;
  analysisVersion: string;
  midiOffset: 48 | 60;
  signal: AbortSignal;
  onProgress?: (stage: string, percent: number) => void;
  run?: typeof runAnalysisCommand;
}): Effect.Effect<OriginalPitch, Error> =>
  Effect.tryPromise({
    try: async () => {
      const checkCancel = () => {
        if (opts.signal.aborted) throw new Error("Analyse abgebrochen.");
      };
      checkCancel();
      const hash = await audioHash(opts.audioPath);
      checkCancel();
      const tracePath = await safeSongFile(opts.songDir, ORIGINAL_PITCH_FILE);
      const previous =
        tracePath && (await stat(tracePath)).size < 32_000_000
          ? await readFile(tracePath, "utf8")
              .then((text) => parseOriginalPitch(JSON.parse(text)))
              .catch(() => null)
          : null;
      if (
        previous?.sourceHash === hash &&
        previous.analysisVersion === opts.analysisVersion &&
        previous.midiOffset === opts.midiOffset &&
        previous.vocalFile &&
        (await safeSongFile(opts.songDir, previous.vocalFile))
      )
        return previous;
      await mkdir(opts.workDir, { recursive: true });
      const scratch = await mkdtemp(join(opts.workDir, "analysis-"));
      const stemName = `vocals-${randomUUID()}.wav`;
      let published = false;
      const run = opts.run ?? runAnalysisCommand;
      try {
        const wav = join(scratch, "input.wav");
        opts.onProgress?.("audio", 0);
        await run(
          "ffmpeg",
          [
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-i",
            opts.audioPath,
            "-vn",
            wav,
          ],
          opts.signal,
          opts.onProgress,
        );
        checkCancel();
        await run(
          opts.python,
          [
            "-m",
            "ultrastar_pipeline.vocalAnalysis",
            "--audio",
            wav,
            "--out",
            scratch,
            "--work-dir",
            join(opts.workDir, opts.analysisVersion),
            "--offset",
            String(opts.midiOffset),
          ],
          opts.signal,
          opts.onProgress,
        );
        checkCancel();
        const result = parseOriginalPitch(
          JSON.parse(
            await readFile(join(scratch, ORIGINAL_PITCH_FILE), "utf8"),
          ),
        );
        if (!result?.points.length)
          throw new Error("Keine verlässliche Gesangstonhöhe gefunden.");
        if ((await audioHash(opts.audioPath)) !== hash)
          throw new Error(
            "Audio wurde während der Analyse geändert. Bitte erneut starten.",
          );
        const trace: OriginalPitch = {
          ...result,
          sourceHash: hash,
          analysisVersion: opts.analysisVersion,
          vocalFile: stemName,
        };
        await serializeFile(
          join(opts.songDir, ORIGINAL_PITCH_FILE),
          async () => {
            checkCancel();
            // Copy across filesystems into a unique file; the manifest is the atomic commit point.
            const { copyFile } = await import("node:fs/promises");
            await copyFile(
              join(scratch, "vocals.wav"),
              join(opts.songDir, stemName),
            );
            checkCancel();
            await atomicWrite(
              join(opts.songDir, ORIGINAL_PITCH_FILE),
              JSON.stringify(trace),
            );
            published = true;
          },
        );
        if (
          previous?.vocalFile &&
          previous.vocalFile !== stemName &&
          pathKey(join(opts.songDir, previous.vocalFile)) !==
            pathKey(opts.audioPath)
        )
          await rm(join(opts.songDir, previous.vocalFile), {
            force: true,
          }).catch(() => {});
        opts.onProgress?.("done", 1);
        return trace;
      } finally {
        if (!published) await rm(join(opts.songDir, stemName), { force: true });
        await rm(scratch, { recursive: true, force: true });
      }
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
