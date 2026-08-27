import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Effect } from "effect";
import { app } from "electron";
import {
  checkFfmpegAvailable,
  checkYtDlpAvailable,
} from "../../core/api/youtube/check.ts";
import { extractZipSafely } from "../../core/archive.ts";
import type { BinariesStatus, BinarySource } from "../shared/ipcContract.ts";
import { broadcast, state } from "./state.ts";

const execFileAsync = promisify(execFile);

type ArchiveType = "zip" | "tar.xz";

type PlatformBinaryConfig = {
  ytDlp: { url: string; exeName: string };
  ffmpeg: {
    url: string;
    exeName: string;
    archiveType: ArchiveType;
    archiveExt: string;
    pathInArchive: string;
  };
};

/** Known download sources per platform. Auto-install is unsupported if a platform is missing here. */
const PLATFORM_BINARIES: Partial<
  Record<NodeJS.Platform, PlatformBinaryConfig>
> = {
  win32: {
    ytDlp: {
      url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
      exeName: "yt-dlp.exe",
    },
    ffmpeg: {
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
      exeName: "ffmpeg.exe",
      archiveType: "zip",
      archiveExt: "zip",
      pathInArchive: "ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe",
    },
  },
  linux: {
    ytDlp: {
      url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
      exeName: "yt-dlp",
    },
    ffmpeg: {
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz",
      exeName: "ffmpeg",
      archiveType: "tar.xz",
      archiveExt: "tar.xz",
      pathInArchive: "ffmpeg-master-latest-linux64-gpl/bin/ffmpeg",
    },
  },
};

/** Exported for tests: takes the platform as a parameter instead of reading process.platform. */
export const resolvePlatformBinaries = (
  platform: NodeJS.Platform,
): PlatformBinaryConfig | undefined => PLATFORM_BINARIES[platform];

export const managedBinDir = (): string => join(app.getPath("userData"), "bin");

let installRunning = false;

/** Prepend userData/bin to PATH so core spawns can find it. */
export const prependManagedBinToPath = (): void => {
  process.env.PATH = `${managedBinDir()}${delimiter}${process.env.PATH ?? ""}`;
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

const classify = async (
  exeName: string,
  availableOnPath: boolean,
): Promise<BinarySource> => {
  if (await fileExists(join(managedBinDir(), exeName))) return "managed";
  if (availableOnPath) return "system";
  return "missing";
};

export const binariesStatus = async (): Promise<BinariesStatus> => {
  const [yt, ff] = await Promise.all([
    Effect.runPromise(checkYtDlpAvailable),
    Effect.runPromise(checkFfmpegAvailable),
  ]);
  const config = resolvePlatformBinaries(process.platform);
  return {
    ytDlp: await classify(config?.ytDlp.exeName ?? "yt-dlp", yt),
    ffmpeg: await classify(config?.ffmpeg.exeName ?? "ffmpeg", ff),
  };
};

/** Download with progress broadcast; only writes to the destination after success. */
const downloadFile = async (
  url: string,
  dest: string,
  name: "yt-dlp" | "ffmpeg",
): Promise<void> => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${url}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const tmp = `${dest}.download`;

  const progress = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (total > 0) {
        broadcast("event:binariesProgress", {
          name,
          percent: Math.min(1, received / total),
        });
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(
      response.body.pipeThrough(
        progress,
      ) as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
    ),
    createWriteStream(tmp),
  );
  await rename(tmp, dest);
};

/**
 * Extract an archive. zip goes through core's guarded extract-zip wrapper;
 * tar.xz (Linux ffmpeg builds) goes through the system tar, since Node has
 * no built-in xz decoder and tar with xz support ships on virtually every
 * Linux distro (AppImages already run directly on the host anyway, just
 * like the PATH resolution of yt-dlp/ffmpeg itself).
 */
const extractArchive = async (
  archivePath: string,
  destDir: string,
  archiveType: ArchiveType,
): Promise<void> => {
  await mkdir(destDir, { recursive: true });
  if (archiveType === "zip") {
    await extractZipSafely(archivePath, destDir);
    return;
  }
  await execFileAsync("tar", ["-xJf", archivePath, "-C", destDir]);
};

/**
 * Install missing binaries (Windows/Linux). Throws if the platform is
 * unsupported.
 * force=true also re-downloads app-managed binaries (the update feature);
 * system installations are never touched.
 */
export const installMissingBinaries = async (force = false): Promise<void> => {
  if (installRunning) return; // an install run is already active
  const config = resolvePlatformBinaries(process.platform);
  if (!config) {
    throw new Error(
      "Automatic install is only supported on Windows and Linux. Please install yt-dlp and ffmpeg manually.",
    );
  }
  const isLinux = process.platform === "linux";
  installRunning = true;
  try {
    const bin = managedBinDir();
    await mkdir(bin, { recursive: true });
    const status = await binariesStatus();

    if (status.ytDlp === "missing" || (force && status.ytDlp === "managed")) {
      const dest = join(bin, config.ytDlp.exeName);
      await downloadFile(config.ytDlp.url, dest, "yt-dlp");
      if (isLinux) await chmod(dest, 0o755);
    }

    if (status.ffmpeg === "missing" || (force && status.ffmpeg === "managed")) {
      const archivePath = join(
        bin,
        `ffmpeg-download.${config.ffmpeg.archiveExt}`,
      );
      await downloadFile(config.ffmpeg.url, archivePath, "ffmpeg");
      const extractDir = join(bin, "ffmpeg-extract");
      await extractArchive(archivePath, extractDir, config.ffmpeg.archiveType);
      const finalPath = join(bin, config.ffmpeg.exeName);
      await rename(join(extractDir, config.ffmpeg.pathInArchive), finalPath);
      if (isLinux) await chmod(finalPath, 0o755);
      await rm(extractDir, { recursive: true, force: true });
      await rm(archivePath, { force: true });
    }

    broadcast("event:binariesProgress", null);
    prependManagedBinToPath();

    // Re-check status and report it to the UI
    const after = await binariesStatus();
    broadcast("event:binariesStatus", after);
    state.setStatus({
      ytDlpAvailable: after.ytDlp !== "missing",
      ffmpegAvailable: after.ffmpeg !== "missing",
    });
  } finally {
    installRunning = false;
  }
};
