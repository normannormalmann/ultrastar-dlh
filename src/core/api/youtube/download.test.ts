import { expect, test } from "bun:test";
import { videoSortArg } from "./download.ts";

test("maps quality settings to yt-dlp -S arguments", () => {
  expect(videoSortArg("720")).toBe("ext,res:720");
  expect(videoSortArg("1080")).toBe("ext,res:1080");
  expect(videoSortArg("best")).toBe("ext");
  expect(videoSortArg(undefined)).toBe("ext,res:1080"); // default unchanged
});
