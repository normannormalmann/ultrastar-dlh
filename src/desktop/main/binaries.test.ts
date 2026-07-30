import { expect, mock, test } from "bun:test";

mock.module("electron", () => ({
  app: { getPath: () => "/tmp/test" },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { resolvePlatformBinaries } = await import("./binaries.ts");

test("win32 config is unchanged (regression guard)", () => {
  const config = resolvePlatformBinaries("win32");
  expect(config?.ytDlp.exeName).toBe("yt-dlp.exe");
  expect(config?.ytDlp.url).toBe(
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  );
  expect(config?.ffmpeg.exeName).toBe("ffmpeg.exe");
  expect(config?.ffmpeg.archiveType).toBe("zip");
  expect(config?.ffmpeg.pathInArchive).toBe(
    "ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe",
  );
});

test("linux config uses extension-less binaries and tar.xz", () => {
  const config = resolvePlatformBinaries("linux");
  expect(config?.ytDlp.exeName).toBe("yt-dlp");
  expect(config?.ytDlp.url).toBe(
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
  );
  expect(config?.ffmpeg.exeName).toBe("ffmpeg");
  expect(config?.ffmpeg.archiveType).toBe("tar.xz");
  expect(config?.ffmpeg.pathInArchive).toBe(
    "ffmpeg-master-latest-linux64-gpl/bin/ffmpeg",
  );
});

test("darwin has no auto-install config", () => {
  expect(resolvePlatformBinaries("darwin")).toBeUndefined();
});
