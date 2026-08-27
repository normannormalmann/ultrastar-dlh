import { spawn } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { Effect } from "effect";
import { killProcessTree } from "../../create/processTree.ts";

// Constants for download behavior
const DOWNLOAD_TIMEOUT_MS = 300_000; // 5 minutes - timeout for yt-dlp process
const PROGRESS_THROTTLE_MS = 67; // ~15 updates per second - throttling for progress updates
const MAX_STDERR_LINES = 50; // Cap stderr buffer to prevent unbounded growth

/**
 * Validates the output path to prevent path traversal attacks.
 * Ensures the path is within a reasonable directory and doesn't contain traversal sequences.
 */
const validateOutputPath = (path: string): void => {
  if (!path || path.trim().length === 0) {
    throw new Error("Output path cannot be empty");
  }

  const resolved = resolve(path);

  // Check for path traversal in the resolved path
  if (resolved.includes("..")) {
    throw new Error("Invalid output path: path traversal detected");
  }

  // Ensure the filename part is reasonable
  const filename = basename(resolved);
  if (!filename || filename.startsWith(".")) {
    throw new Error("Invalid output path: invalid filename");
  }
};

/**
 * Securely validates and normalizes the cookies browser parameter.
 * Prevents command injection and path traversal attacks.
 */
const validateCookiesBrowserParam = (
  cookiesBrowser: string | undefined,
): string[] | undefined => {
  if (!cookiesBrowser) return undefined;

  // Remove quotes and trim whitespace
  const val = cookiesBrowser.replace(/^["']+|["']+$/g, "").trim();

  // Maximum length to prevent buffer overflow attacks
  const MAX_LENGTH = 255;
  if (val.length > MAX_LENGTH || val.length === 0) {
    throw new Error(
      `Invalid cookies browser parameter: length must be between 1 and ${MAX_LENGTH}`,
    );
  }

  // Whitelist of supported browser names for --cookies-from-browser
  const ALLOWED_BROWSERS = [
    "chrome",
    "chrome+",
    "chromium",
    "chromium+",
    "brave",
    "brave+",
    "edge",
    "edge+",
    "firefox",
    "firefox+",
    "opera",
    "opera+",
    "vivaldi",
    "vivaldi+",
    "safari",
  ] as const;

  // Check if it's a file path (contains backslash or forward slash)
  if (val.includes("\\") || val.includes("/")) {
    // Normalize the path to prevent path traversal
    const normalizedPath = normalize(val);

    // Resolve to absolute path to prevent relative path attacks
    const resolvedPath = resolve(normalizedPath);

    // Check if path contains parent directory references (should be resolved by now)
    if (resolvedPath.includes("..")) {
      throw new Error("Invalid cookies file path: path traversal detected");
    }

    // Validate file extension
    if (!/\.(txt|json)$/i.test(resolvedPath)) {
      throw new Error("Invalid cookies file: must be .txt or .json format");
    }

    // Check if file exists and is actually a file (not a directory or symlink)
    // Use lstatSync instead of existsSync to prevent symlink attacks
    try {
      const stats = lstatSync(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(
          `Invalid cookies file: path is not a file (is ${stats.isDirectory() ? "directory" : "special file"}): ${resolvedPath}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Invalid cookies file: cannot access file at ${resolvedPath}: ${message}`,
      );
    }

    return ["--cookies", resolvedPath];
  }
  // It's a browser name - validate against whitelist
  if (!ALLOWED_BROWSERS.includes(val as (typeof ALLOWED_BROWSERS)[number])) {
    throw new Error(
      `Invalid browser name: '${val}'. Supported browsers: ${ALLOWED_BROWSERS.join(", ")}`,
    );
  }
  return ["--cookies-from-browser", val];
};

export type VideoQuality = "720" | "1080" | "best";

/** yt-dlp -S sort expression for the chosen maximum quality. */
export const videoSortArg = (quality?: VideoQuality): string =>
  quality === "720"
    ? "ext,res:720"
    : quality === "best"
      ? "ext"
      : "ext,res:1080";

/**
 * Download a youtube video from direct link (watch URL or ID) and save to provided path.
 * Equivalent shell: yt-dlp -S "ext,res:1080" -o '${path}' -- ${link}
 */
export const downloadYoutubeVideo = (
  link: string,
  path: string,
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      validateOutputPath(path);
      const args = ["-S", "ext,res:1080", "-o", path, "--", link];

      await new Promise<void>((resolve, reject) => {
        const child = spawn("yt-dlp", args, {
          stdio: ["ignore", "ignore", "ignore"],
        });

        // Set timeout to prevent indefinite hanging
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
        }, DOWNLOAD_TIMEOUT_MS);

        const cleanup = () => clearTimeout(timeout);

        child.on("error", (err) => {
          cleanup();
          reject(err);
        });
        child.on("close", (code) => {
          cleanup();
          if (code === 0) resolve();
          else reject(new Error(`yt-dlp download failed (code ${code})`));
        });
      });
    },
    catch: (e) =>
      e instanceof Error ? e : new Error("Failed to download youtube video"),
  });

export type YoutubeDownloadProgress = {
  percent: number; // 0..1
  eta?: string; // e.g. 00:12
  speed?: string; // e.g. 2.31MiB/s
};

// New type for the JSON progress output from yt-dlp
type YtDlpProgressData = {
  type: "progress";
  downloaded: number | string;
  total: "NA" | string;
  frag_index: number | string;
  frag_count: number | string;
};

/**
 * Run a yt-dlp download with the given arguments. Shared by both attempts (with and without cookies).
 */
const runYtDlpDownload = (
  args: string[],
  onProgress: (p: YoutubeDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // yt-dlp spawns ffmpeg for the merge; killing only the parent would
    // leave that child holding the partial file. Same mechanics as
    // pipeline.ts.
    const abbrechen = (): void => killProcessTree(child);
    signal?.addEventListener("abort", abbrechen, { once: true });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
    }, DOWNLOAD_TIMEOUT_MS);

    const stderrLines: string[] = [];
    let lastUpdate = 0;
    let pendingUpdate: YoutubeDownloadProgress | null = null;

    const throttledUpdate = (progress: YoutubeDownloadProgress) => {
      const now = Date.now();
      if (now - lastUpdate >= PROGRESS_THROTTLE_MS) {
        lastUpdate = now;
        onProgress(progress);
        pendingUpdate = null;
      } else {
        pendingUpdate = progress;
      }
    };

    const flushInterval = setInterval(() => {
      if (pendingUpdate) {
        onProgress(pendingUpdate);
        pendingUpdate = null;
        lastUpdate = Date.now();
      }
    }, PROGRESS_THROTTLE_MS);

    const parseAndEmit = (line: string) => {
      try {
        const raw = line.trim();
        if (raw.length === 0) return;
        const maybeUnwrapped =
          (raw.startsWith("'") && raw.endsWith("'")) ||
          (raw.startsWith('"') && raw.endsWith('"'))
            ? raw.slice(1, -1)
            : raw;
        const data = JSON.parse(maybeUnwrapped) as YtDlpProgressData;

        if (data.type === "progress") {
          let percent = 0;

          const toNumber = (v: unknown): number => {
            if (typeof v === "number") return v;
            const n = Number.parseInt(String(v), 10);
            return Number.isNaN(n) ? Number.NaN : n;
          };

          if (data.total !== "NA") {
            const total = toNumber(data.total);
            const downloaded = toNumber(data.downloaded);
            if (
              !Number.isNaN(total) &&
              total > 0 &&
              !Number.isNaN(downloaded)
            ) {
              percent = Math.max(0, Math.min(1, downloaded / total));
            } else {
              const fragCount = toNumber(data.frag_count);
              const fragIndex = toNumber(data.frag_index);
              if (
                !Number.isNaN(fragCount) &&
                fragCount > 0 &&
                !Number.isNaN(fragIndex)
              ) {
                percent = Math.max(
                  0,
                  Math.min(1, Math.min(fragIndex, fragCount) / fragCount),
                );
              }
            }
          } else {
            const fragCount = toNumber(data.frag_count);
            const fragIndex = toNumber(data.frag_index);
            if (
              !Number.isNaN(fragCount) &&
              fragCount > 0 &&
              !Number.isNaN(fragIndex)
            ) {
              const clampedIndex = Math.min(fragIndex, fragCount);
              percent = Math.max(0, Math.min(1, clampedIndex / fragCount));
            }
          }

          throttledUpdate({ percent });
        }
      } catch {
        // Ignore non-JSON lines
      }
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const text = chunk as string;
      text.split(/[\r\n]+/).forEach((line) => {
        if (line.trim() && stderrLines.length < MAX_STDERR_LINES) {
          stderrLines.push(line.trim());
        }
        parseAndEmit(line);
      });
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const text = chunk as string;
      text.split(/[\r\n]+/).forEach(parseAndEmit);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      clearInterval(flushInterval);
      signal?.removeEventListener("abort", abbrechen);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      clearInterval(flushInterval);
      signal?.removeEventListener("abort", abbrechen);
      if (signal?.aborted) {
        reject(new Error("Download abgebrochen."));
        return;
      }
      if (code === 0) {
        onProgress({ percent: 1 });
        resolve();
      } else {
        const detail = stderrLines.slice(-8).join(" | ");
        reject(
          new Error(
            `yt-dlp download failed (code ${code})${detail ? `: ${detail}` : ""}`,
          ),
        );
      }
    });
  });

/**
 * Searches for a cookies.txt file in common locations relative to the output path.
 * Returns the absolute path if found, undefined otherwise.
 */
const findCookiesTxt = (outputPath: string): string | undefined => {
  const candidates = [
    // Download base dir (e.g. /songs/)
    join(dirname(dirname(outputPath)), "cookies.txt"),
    // CWD
    join(process.cwd(), "cookies.txt"),
  ];

  for (const candidate of candidates) {
    try {
      const resolved = resolve(candidate);
      if (existsSync(resolved) && lstatSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // skip
    }
  }
  return undefined;
};

/**
 * True when yt-dlp could not read the browser's cookies at all, rather than
 * failing the download itself. The profile may be locked by a running browser
 * (https://github.com/yt-dlp/yt-dlp/issues/7271), decryption may have failed,
 * or the database may be missing. Every one of these is worth retrying with a
 * cookies.txt file or with no cookies at all.
 */
export const isCookieExtractionFailure = (message: string): boolean =>
  message.includes("DPAPI") ||
  /could not copy .*cookie database/i.test(message) ||
  /could not find .*cookies? database/i.test(message);

/**
 * Download with progress updates via callback. Parses yt-dlp stdout progress lines in JSON format.
 * When the cookies could not be read, or on auth errors, falls back to cookies.txt
 * if found, then retries without cookies.
 */
export const downloadYoutubeVideoWithProgress = (
  link: string,
  path: string,
  onProgress: (p: YoutubeDownloadProgress) => void,
  cookiesBrowser?: string,
  quality?: VideoQuality,
  signal?: AbortSignal,
): Effect.Effect<void, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      validateOutputPath(path);

      const baseArgs = [
        "-S",
        videoSortArg(quality),
        "-o",
        path,
        "--merge-output-format",
        "mp4",
        "--quiet",
        "--newline",
        "--progress",
        "--progress-template",
        `{"type": "progress", "downloaded": "%(progress.downloaded_bytes)s", "total": "%(progress.total_bytes)s", "frag_index": "%(progress.fragment_index)s", "frag_count": "%(progress.fragment_count)s"}`,
      ];

      const cookieArgs = validateCookiesBrowserParam(cookiesBrowser) ?? [];
      const fullArgs = [...baseArgs, ...cookieArgs, "--", link];

      try {
        await runYtDlpDownload(fullArgs, onProgress, signal);
      } catch (err) {
        // The user cancelled - no retry chain, no second process.
        if (signal?.aborted) throw err;
        const message = err instanceof Error ? err.message : String(err);

        const isCookieFailure = isCookieExtractionFailure(message);
        const isAuthBlock =
          message.includes("Sign in to confirm") ||
          message.includes("page needs to be reloaded") ||
          message.includes("confirm your age");

        const tryFallbackWithoutCookies = async () => {
          if (signal?.aborted) throw err;
          onProgress({ percent: 0 });
          const noCookiesArgs = [...baseArgs, "--", link];
          try {
            await runYtDlpDownload(noCookiesArgs, onProgress, signal);
          } catch (fallbackErr) {
            const fallbackMsg =
              fallbackErr instanceof Error
                ? fallbackErr.message
                : String(fallbackErr);
            const isFallbackAuthBlock =
              fallbackMsg.includes("Sign in to confirm") ||
              fallbackMsg.includes("page needs to be reloaded") ||
              fallbackMsg.includes("confirm your age") ||
              fallbackMsg.includes("Video unavailable");

            if (isFallbackAuthBlock) {
              if (isCookieFailure) {
                throw new Error(
                  `Could not read the cookies from '${cookiesBrowser}' (the browser holds a lock on its profile, or decryption failed). The download without cookies was blocked by YouTube bot protection. Please close the browser and try again, or use a 'cookies.txt' file.`,
                );
              }
              throw new Error(
                "YouTube bot protection blocked the download. Please ensure you are logged into YouTube in your selected browser, or place a valid 'cookies.txt' file in your songs directory.",
              );
            }
            // If fallback fails for another reason, throw the original error for more context
            throw err;
          }
        };

        if (isCookieFailure || isAuthBlock) {
          const cookiesTxt = findCookiesTxt(path);

          if (cookiesTxt && cookieArgs.length > 0) {
            onProgress({ percent: 0 });
            const fallbackArgs = [
              ...baseArgs,
              "--cookies",
              cookiesTxt,
              "--",
              link,
            ];
            try {
              await runYtDlpDownload(fallbackArgs, onProgress, signal);
              return;
            } catch (fallbackErr) {
              // A cancel killed this attempt: retrying would spawn a yt-dlp
              // that the already-fired signal can no longer reach.
              if (signal?.aborted) throw fallbackErr;
              await tryFallbackWithoutCookies();
              return;
            }
          } else if (cookiesTxt && cookieArgs.length === 0) {
            onProgress({ percent: 0 });
            const fallbackArgs = [
              ...baseArgs,
              "--cookies",
              cookiesTxt,
              "--",
              link,
            ];
            try {
              await runYtDlpDownload(fallbackArgs, onProgress, signal);
              return;
            } catch (fallbackErr) {
              // A cancel killed this attempt: retrying would spawn a yt-dlp
              // that the already-fired signal can no longer reach.
              if (signal?.aborted) throw fallbackErr;
              await tryFallbackWithoutCookies();
              return;
            }
          } else if (cookieArgs.length > 0) {
            if (isAuthBlock && !isCookieFailure) {
              // If cookies were extracted but we still got an auth block, no-cookies will also fail.
              throw new Error(
                `YouTube blocked the download (bot protection). Your browser cookies from '${cookiesBrowser}' were used but did not bypass the check. Are you logged into YouTube? You may also try a 'cookies.txt' file.`,
              );
            }
            await tryFallbackWithoutCookies();
            return;
          } else if (isAuthBlock) {
            throw new Error(
              "YouTube bot protection blocked the download. Please configure a browser for cookies or place a valid 'cookies.txt' file in your songs directory.",
            );
          }
        }

        throw err;
      }
    },
    catch: (e) =>
      e instanceof Error
        ? e
        : new Error("Failed to download youtube video with progress"),
  });
