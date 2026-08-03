// Playing time of a source. Only needed for the two side entrances (pasted
// link, local file); a search hit already carries its duration. The LRCLIB
// endpoint matches on duration, so a guessed number is worse than none -
// every failure path returns null.
import { spawn } from "node:child_process";
import { Effect } from "effect";
import type { MediaQuelle } from "./media.ts";

const PROBE_TIMEOUT_MS = 30_000;
const FFMPEG_DAUER = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;

/** `yt-dlp --print duration` prints bare seconds, one line per video. */
export const dauerAusYtDlp = (stdout: string): number | null => {
  const erste = stdout.trim().split("\n")[0]?.trim() ?? "";
  const wert = Number.parseFloat(erste);
  return Number.isFinite(wert) && wert > 0 ? wert : null;
};

/**
 * ffmpeg has no machine-readable duration output; it sits in the banner on
 * stderr. Deliberately text parsing with a null fallback: if ffmpeg ever
 * changes the banner, step 3 loses its suggestion - it must not receive a
 * wrong number.
 */
export const dauerAusFfmpeg = (stderr: string): number | null => {
  const t = FFMPEG_DAUER.exec(stderr);
  if (!t) return null;
  const [, h, m, s, ms] = t;
  const sek =
    Number(h) * 3600 +
    Number(m) * 60 +
    Number(s) +
    (ms ? Number(`0.${ms}`) : 0);
  return sek > 0 ? sek : null;
};

/**
 * The URL reaches argv as a *positional* argument, so a value starting with
 * "-" would be read as an option ("--exec=..." being the ugly case), and
 * yt-dlp's extractors accept far more than http. Both holes close here.
 */
const istWebUrl = (roh: string): boolean => {
  try {
    const u = new URL(roh);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Resolves with both streams regardless of the exit code: `ffmpeg -i <file>`
 * without an output file always exits non-zero ("At least one output file must
 * be specified") - and prints the duration before it does.
 */
const laufe = (
  befehl: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const kind = spawn(befehl, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const uhr = setTimeout(() => {
      kind.kill();
      reject(new Error(`${befehl}: Zeitueberschreitung bei der Dauer-Probe.`));
    }, PROBE_TIMEOUT_MS);
    kind.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    kind.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    kind.on("error", (e) => {
      clearTimeout(uhr);
      reject(e);
    });
    kind.on("close", () => {
      clearTimeout(uhr);
      resolve({ stdout, stderr });
    });
  });

/**
 * yt-dlp and ffmpeg live on PATH: managedBinDir() is prepended by the desktop
 * main process, same as in media.ts.
 */
export const dauerSekunden = (
  quelle: MediaQuelle,
): Effect.Effect<number | null, never> =>
  Effect.catchAll(
    Effect.tryPromise(async () => {
      if (quelle.kind === "youtube") {
        if (!istWebUrl(quelle.url)) return null;
        const { stdout } = await laufe("yt-dlp", [
          "--print",
          "duration",
          "--skip-download",
          "--no-warnings",
          "--",
          // Nothing after this is read as a flag.
          quelle.url,
        ]);
        return dauerAusYtDlp(stdout);
      }
      // No "--" for ffmpeg: it has no argv terminator, and the path sits in
      // the value position of -i, which ffmpeg consumes as a filename
      // whatever it starts with. A "--" here would BE the filename.
      const { stderr } = await laufe("ffmpeg", ["-i", quelle.pfad]);
      return dauerAusFfmpeg(stderr);
    }),
    () => Effect.succeed(null),
  );
