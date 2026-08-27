import { expect, test } from "bun:test";
import { isCookieExtractionFailure, videoSortArg } from "./download.ts";

test("maps quality settings to yt-dlp -S arguments", () => {
  expect(videoSortArg("720")).toBe("ext,res:720");
  expect(videoSortArg("1080")).toBe("ext,res:1080");
  expect(videoSortArg("best")).toBe("ext");
  expect(videoSortArg(undefined)).toBe("ext,res:1080"); // default unchanged
});

test("treats a locked or unreadable browser cookie store as a cookie failure", () => {
  // The message the user sees when Chrome holds a lock on its profile:
  // https://github.com/yt-dlp/yt-dlp/issues/7271
  expect(
    isCookieExtractionFailure(
      "yt-dlp download failed (code 1): ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info",
    ),
  ).toBe(true);
  expect(
    isCookieExtractionFailure("ERROR: Failed to decrypt with DPAPI"),
  ).toBe(true);
  expect(
    isCookieExtractionFailure(
      "ERROR: could not find chrome cookies database in /home/x",
    ),
  ).toBe(true);
});

test("does not treat an ordinary download failure as a cookie failure", () => {
  expect(isCookieExtractionFailure("ERROR: Video unavailable")).toBe(false);
  expect(
    isCookieExtractionFailure("ERROR: Sign in to confirm you are not a bot"),
  ).toBe(false);
});
