// Opt-in live acceptance check. No account registration and no library writes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import envPaths from "env-paths";
import { Effect } from "effect";
import { protectSecret } from "../src/core/storage/protectSecret.ts";
import { login } from "../src/core/api/usdb/auth.ts";
import { searchSongs } from "../src/core/api/usdb/search.ts";
import { getLyricsById } from "../src/core/api/usdb/lyrics.ts";
import { getYoutubeLinksById } from "../src/core/api/usdb/youtube.ts";
import { videoIdAusLink } from "../src/core/create/media.ts";
import { resolveYoutubePreview } from "../src/core/api/youtube/preview.ts";

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? ".verification/live");
  await mkdir(out, { recursive: false });
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    login: false,
    search: false,
    lyrics: false,
    preview: false,
    decodedAudio: false,
  };
  try {
    const path =
      process.argv[3] ??
      join(
        envPaths(process.env.ULTRASTAR_APP_NAME ?? "ultrastar-cli", {
          suffix: "",
        }).cache,
        "credentials.json",
      );
    const stored = JSON.parse(await readFile(path, "utf8"));
    const credentials =
      stored.protection === "dpapi"
        ? JSON.parse(await protectSecret(stored.data, true))
        : stored;
    if (
      typeof credentials.user !== "string" ||
      typeof credentials.pass !== "string"
    )
      throw new Error("No existing credentials");
    const cookie = await Effect.runPromise(login(credentials));
    report.login = true;
    const page = await Effect.runPromise(
      searchSongs({ limit: 5, order: "lastchange" }, cookie),
    );
    if (!page.songs.length) throw new Error("Search returned no songs");
    report.search = true;
    for (const song of page.songs) {
      const lyrics = await Effect.runPromise(getLyricsById(song.apiId, cookie));
      if (!lyrics?.lyrics) continue;
      report.lyrics = true;
      const links = await Effect.runPromise(
        getYoutubeLinksById(song.apiId, cookie),
      );
      const id = links[0]?.link ? videoIdAusLink(links[0].link) : null;
      if (!id) continue;
      try {
        const url = await Effect.runPromise(resolveYoutubePreview(id));
        report.preview = true;
        const target = join(out, "sample.wav");
        await promisify(execFile)(
          "ffmpeg",
          [
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-i",
            url,
            "-t",
            "3",
            "-vn",
            target,
          ],
          { windowsHide: true, timeout: 60_000, maxBuffer: 1_000_000 },
        );
        if ((await stat(target)).size > 44) {
          report.decodedAudio = true;
          break;
        }
      } catch {
        /* Try another linked video; never log signed URLs or cookies. */
      }
    }
    if (!report.decodedAudio)
      throw new Error(
        "No linked YouTube preview could be decoded; check provider restrictions and yt-dlp",
      );
  } catch (error) {
    report.error =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "Existing credentials file missing; no account was registered"
        : "Live check failed; see individual completed stages";
    process.exitCode = 1;
  } finally {
    await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
