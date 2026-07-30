import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Effect } from "effect";
import { app } from "electron";
import extractZip from "extract-zip";
import {
  checkFfmpegAvailable,
  checkYtDlpAvailable,
} from "../../core/api/youtube/check.ts";
import type { BinariesStatus, BinarySource } from "../shared/ipc-contract.ts";
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

/** Bekannte Download-Quellen je Plattform. Fehlt ein Eintrag, ist Auto-Install nicht unterstützt. */
const PLATFORM_BINARIES: Partial<Record<NodeJS.Platform, PlatformBinaryConfig>> = {
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

/** Exportiert für Tests: nimmt die Plattform als Parameter statt process.platform zu lesen. */
export const resolvePlatformBinaries = (
  platform: NodeJS.Platform,
): PlatformBinaryConfig | undefined => PLATFORM_BINARIES[platform];

export const managedBinDir = (): string => join(app.getPath("userData"), "bin");

let installRunning = false;

/** userData/bin dem PATH voranstellen, damit Core-Spawns es finden. */
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

/** Download mit Fortschritts-Broadcast; schreibt erst nach Erfolg an den Zielort. */
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
 * Archiv entpacken. zip läuft über die bestehende extract-zip-Abhängigkeit;
 * tar.xz (Linux-ffmpeg-Builds) über das System-tar, da Node keinen
 * eingebauten xz-Decoder hat und tar mit xz-Support auf praktisch jeder
 * Linux-Distribution vorhanden ist (AppImages laufen ohnehin direkt auf dem
 * Host, wie schon die PATH-Auflösung von yt-dlp/ffmpeg selbst).
 */
const extractArchive = async (
  archivePath: string,
  destDir: string,
  archiveType: ArchiveType,
): Promise<void> => {
  await mkdir(destDir, { recursive: true });
  if (archiveType === "zip") {
    await extractZip(archivePath, { dir: destDir });
    return;
  }
  await execFileAsync("tar", ["-xJf", archivePath, "-C", destDir]);
};

/**
 * Fehlende Binaries installieren (Windows/Linux). Wirft, wenn die Plattform
 * nicht unterstützt wird.
 * force=true lädt auch app-verwaltete Binaries neu (Update-Funktion);
 * System-Installationen werden nie angefasst.
 */
export const installMissingBinaries = async (force = false): Promise<void> => {
  if (installRunning) return; // bereits ein Install-Lauf aktiv
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
      const archivePath = join(bin, `ffmpeg-download.${config.ffmpeg.archiveExt}`);
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

    // Status neu prüfen und an die UI melden
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
