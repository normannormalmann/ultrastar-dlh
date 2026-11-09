import { execFile } from "node:child_process";
import { Effect } from "effect";

export const isPreviewUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".googlevideo.com") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

/** Resolve an expiring stream URL; media is streamed by Chromium, never added to the library. */
export const resolveYoutubePreview = (
  videoId: string,
): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        if (!/^[\w-]{11}$/.test(videoId)) {
          reject(new Error("Ungültige YouTube-ID."));
          return;
        }
        execFile(
          "yt-dlp",
          [
            "--no-playlist",
            "--no-warnings",
            "--get-url",
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "--",
            `https://www.youtube.com/watch?v=${videoId}`,
          ],
          { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true },
          (error, stdout) => {
            if (error) {
              reject(
                new Error(
                  "Vorschau konnte nicht geladen werden. Prüfe yt-dlp und die Erreichbarkeit von YouTube.",
                ),
              );
              return;
            }
            const url = stdout.trim();
            if (!isPreviewUrl(url)) {
              reject(
                new Error("YouTube lieferte keine unterstützte Vorschau."),
              );
              return;
            }
            resolve(url);
          },
        );
      }),
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
