// Real-model acceptance runner. Original audio and song files are read-only.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, delimiter } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { findeAudio, lyricsAusReferenz } from "./evaluate-pipeline.ts";
import {
  compareToReference,
  parseReferenceTxt,
} from "../src/core/create/evaluate.ts";
import { parseSongData } from "../src/core/create/songData.ts";
import { renderSongTxt } from "../src/core/create/writeSongTxt.ts";
import { decodeSongBytes } from "../src/core/edit/songFile.ts";
import { parseOriginalPitch } from "../src/core/edit/originalVocal.ts";
import { sidecarFingerprint } from "../src/core/create/environment.ts";

const exec = promisify(execFile);
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1]!;
};

if (import.meta.main) {
  const manifestPath = process.argv[2];
  if (!manifestPath)
    throw new Error(
      "Usage: modelRegression.ts <corpus.json> --python <interpreter> --device cpu|cuda --out <new directory>",
    );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const out = resolve(arg("out", ".verification/model-regression"));
  await mkdir(out, { recursive: false });
  const device = arg("device", "cpu");
  if (!["cpu", "cuda"].includes(device))
    throw new Error("Explicit cpu or cuda required");
  const python = arg("python", process.env.PIPELINE_PYTHON ?? "python");
  const sidecar = resolve(arg("sidecar", "python-sidecar"));
  const fingerprint = await sidecarFingerprint(sidecar);
  const limit = Number(arg("limit", "1"));
  const results: unknown[] = [];
  for (const [index, entry] of manifest.songs.slice(0, limit).entries()) {
    const dir = join(out, String(index));
    await mkdir(dir);
    const referenceBytes = await readFile(join(entry.songDir, "song.txt"));
    const reference = decodeSongBytes(referenceBytes).text;
    const audio = await findeAudio(entry.songDir, reference);
    if (!audio) throw new Error(`Missing audio: ${entry.songDir}`);
    const audioPath = join(dir, "input.wav");
    await exec(
      "ffmpeg",
      ["-nostdin", "-loglevel", "error", "-i", audio, "-vn", audioPath],
      { windowsHide: true, timeout: 120_000 },
    );
    const lyricsPath = join(dir, "lyrics.txt");
    await writeFile(lyricsPath, lyricsAusReferenz(reference).join("\n"));
    const output = join(dir, "song_data.json");
    const reportPath = join(dir, "resources.json");
    const started = Date.now();
    let failure: string | undefined;
    try {
      const { stdout, stderr } = await exec(
        python,
        [
          resolve("scripts/modelProbe.py"),
          reportPath,
          "--audio",
          audioPath,
          "--lyrics-file",
          lyricsPath,
          "--language",
          manifest.language ?? "de",
          "--device",
          device,
          "--work-dir",
          join(dir, "cache"),
          "--out",
          output,
        ],
        {
          windowsHide: true,
          timeout: 1_200_000,
          maxBuffer: 8_000_000,
          env: {
            ...process.env,
            PYTHONPATH: [sidecar, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(delimiter),
          },
        },
      );
      await writeFile(join(dir, "process.log"), stdout + stderr);
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      await writeFile(
        join(dir, "process.log"),
        `${e.stdout ?? ""}\n${e.stderr ?? ""}`,
      );
      failure = e.message?.slice(0, 300) ?? String(error);
    }
    let metrics: ReturnType<typeof compareToReference> | undefined;
    if (!failure) {
      const data = parseSongData(JSON.parse(await readFile(output, "utf8")));
      const trace = parseOriginalPitch(
        JSON.parse(await readFile(join(dir, "originalPitch.json"), "utf8")),
      );
      if (!trace?.points.length)
        throw new Error("Missing voiced pitch measurements");
      const wav = await readFile(join(dir, "vocals.wav"));
      if (wav.subarray(0, 4).toString() !== "RIFF" || wav.length < 44)
        throw new Error("Invalid vocal stem");
      metrics = compareToReference(
        parseReferenceTxt(
          renderSongTxt(data, {
            artist: entry.artist,
            title: entry.title,
            mp3: "audio.wav",
          }),
        ),
        parseReferenceTxt(reference),
      );
    }
    results.push({
      index,
      device,
      seconds: (Date.now() - started) / 1000,
      referenceHash: createHash("sha256").update(referenceBytes).digest("hex"),
      audioHash: createHash("sha256")
        .update(await readFile(audioPath))
        .digest("hex"),
      metrics,
      failure,
    });
    await writeFile(
      join(out, "results.json"),
      JSON.stringify({ fingerprint, results }, null, 2),
    );
    console.log(JSON.stringify(results.at(-1)));
  }
  if (results.some((row) => (row as { failure?: string }).failure))
    process.exitCode = 1;
}
