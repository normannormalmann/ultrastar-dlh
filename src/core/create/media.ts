// src/core/create/media.ts
// Everything the pipeline needs before it can start: an audio track, and
// - when the source is a link - the video that ships with the package.
// Nothing here writes into the library; the job scratch dir holds it all
// until assemblePackage moves the finished folder over.
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { downloadYoutubeVideoWithProgress } from "../api/youtube/download.ts";
import type { VideoQuality } from "../api/youtube/download.ts";

export type MediaQuelle =
  | { kind: "youtube"; url: string }
  | { kind: "datei"; pfad: string };

export type AcquiredMedia = {
  /** Feeds the pipeline. Scratch for links, the original for files. */
  audioPath: string;
  /** Only for links - a local file has no video. */
  videoPath?: string;
  /** Thumbnail or embedded art; the Cover Art Archive outranks it. */
  coverKandidat?: string;
};

export type MediaErrorKind =
  | "DownloadFailed"
  | "AudioExtractionFailed"
  | "UnreadableFile"
  | "Cancelled";

export type MediaError = { kind: MediaErrorKind; detail: string };

export type AcquireDeps = {
  downloadVideo?: typeof downloadYoutubeVideoWithProgress;
  runFfmpeg?: (args: string[]) => Promise<void>;
  fetchFn?: typeof fetch;
};

export type AcquireOptions = {
  quelle: MediaQuelle;
  jobDir: string;
  cookiesBrowser?: string;
  videoQuality?: VideoQuality;
  onProgress?: (anteil: number) => void;
  /** Reaches yt-dlp: a cancel during the download kills the process tree. */
  signal?: AbortSignal;
  deps?: AcquireDeps;
};

const ID_MUSTER = [
  /youtu\.be\/([A-Za-z0-9_-]{6,})/,
  /[?&]v=([A-Za-z0-9_-]{6,})/,
  /\/embed\/([A-Za-z0-9_-]{6,})/,
];

export const videoIdAusLink = (url: string): string | null => {
  for (const muster of ID_MUSTER) {
    const treffer = muster.exec(url);
    if (treffer?.[1]) return treffer[1];
  }
  return null;
};

/** ffmpeg lives on PATH: managedBinDir() is prepended by the desktop main. */
const ffmpegStandard = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const kind = spawn("ffmpeg", ["-y", ...args], { stdio: "ignore" });
    kind.on("error", reject);
    kind.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg endete mit ${code}`)),
    );
  });

/** Best-effort: a missing thumbnail costs a warning, never the job. */
const holeThumbnail = async (
  url: string,
  ziel: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> => {
  const id = videoIdAusLink(url);
  if (!id) return undefined;
  for (const name of ["maxresdefault", "hqdefault"]) {
    try {
      const antwort = await fetchFn(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
      if (!antwort.ok) continue;
      await writeFile(ziel, new Uint8Array(await antwort.arrayBuffer()));
      return ziel;
    } catch {
      // Next candidate, then give up.
    }
  }
  return undefined;
};

export const acquireMedia = (
  opts: AcquireOptions,
): Effect.Effect<AcquiredMedia, MediaError> =>
  Effect.gen(function* () {
    const runFfmpeg = opts.deps?.runFfmpeg ?? ffmpegStandard;
    const fetchFn = opts.deps?.fetchFn ?? fetch;

    const pruefeAbbruch = (): MediaError | null =>
      opts.signal?.aborted ? { kind: "Cancelled", detail: "Abgebrochen." } : null;

    const vorher = pruefeAbbruch();
    if (vorher) return yield* Effect.fail(vorher);

    // Nobody else creates it: yt-dlp makes its own -o parent, but the
    // local-file branch writes embedded.jpg here first, and ffmpeg would
    // fail silently into "no embedded art".
    yield* Effect.tryPromise({
      try: () => mkdir(opts.jobDir, { recursive: true }),
      // tryPromise, not promise: a failed mkdir (EACCES, ENOSPC) would
      // otherwise escape Effect.either as a defect and render as garbage.
      catch: (e): MediaError => ({
        kind: "UnreadableFile",
        detail: `Arbeitsverzeichnis nicht anlegbar: ${e instanceof Error ? e.message : String(e)}`,
      }),
    });

    if (opts.quelle.kind === "datei") {
      const pfad = opts.quelle.pfad;
      yield* Effect.tryPromise({
        // stat().isFile(), not access(): a directory passes access() and
        // would only blow up much later inside the worker.
        try: async () => {
          if (!(await stat(pfad)).isFile()) {
            throw new Error("Kein regulaeres File.");
          }
        },
        catch: (e): MediaError => ({
          kind: "UnreadableFile",
          detail: `Datei nicht lesbar: ${e instanceof Error ? e.message : String(e)}`,
        }),
      });
      // Embedded art, if any. ffmpeg fails when there is no art stream -
      // that is a normal outcome, not an error.
      const bild = join(opts.jobDir, "embedded.jpg");
      const hatBild = yield* Effect.promise(async () => {
        try {
          await runFfmpeg(["-i", pfad, "-an", "-c:v", "copy", bild]);
          return true;
        } catch {
          return false;
        }
      });
      opts.onProgress?.(1);
      return {
        audioPath: pfad,
        coverKandidat: hatBild ? bild : undefined,
      } satisfies AcquiredMedia;
    }

    // Held in a const: the narrowing to the youtube variant does not
    // survive into the closures below.
    const url = opts.quelle.url;
    const videoPath = join(opts.jobDir, "video.mp4");
    const laden = opts.deps?.downloadVideo ?? downloadYoutubeVideoWithProgress;
    yield* Effect.mapError(
      laden(
        url,
        videoPath,
        (p) => opts.onProgress?.((p.percent ?? 0) * 0.8),
        opts.cookiesBrowser,
        opts.videoQuality,
        opts.signal,
      ),
      (e): MediaError =>
        // A killed yt-dlp reports a plain error; only the signal tells us
        // this was the user, not a broken download.
        opts.signal?.aborted
          ? { kind: "Cancelled", detail: "Abgebrochen." }
          : { kind: "DownloadFailed", detail: e.message },
    );

    // A cancel that lands during the download surfaces as a yt-dlp error;
    // it must be reported as the user decision it is, not as a failure.
    const nachDownload = pruefeAbbruch();
    if (nachDownload) return yield* Effect.fail(nachDownload);

    // Copy the audio stream out instead of handing the sidecar the .mp4:
    // the stage cache keys on an audio hash, and a small stable file is
    // the more reliable key.
    const audioPath = join(opts.jobDir, "audio.m4a");
    yield* Effect.tryPromise({
      try: () => runFfmpeg(["-i", videoPath, "-vn", "-c:a", "copy", audioPath]),
      catch: (e): MediaError => ({
        kind: "AudioExtractionFailed",
        detail: e instanceof Error ? e.message : String(e),
      }),
    });
    opts.onProgress?.(0.9);

    const coverKandidat = yield* Effect.promise(() =>
      holeThumbnail(url, join(opts.jobDir, "thumbnail.jpg"), fetchFn),
    );
    opts.onProgress?.(1);
    return { audioPath, videoPath, coverKandidat } satisfies AcquiredMedia;
  });
