import { expect, test } from "bun:test";
import { validateIpcPayload, youtubeUrl } from "./validateIpc.ts";
import { isPreviewUrl } from "../../core/api/youtube/preview.ts";

test("rejects path-shaped cover IDs, command URLs and malformed jobs", () => {
  expect(() => validateIpcPayload("covers:get", "../../secret")).toThrow();
  expect(() => validateIpcPayload("covers:get", 123)).not.toThrow();
  expect(() =>
    validateIpcPayload("create:queueAdd", [{ id: "../../outside" }]),
  ).toThrow();
  expect(youtubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
  expect(youtubeUrl("https://youtube.com.attacker.invalid/watch?v=abc")).toBe(
    false,
  );
  expect(youtubeUrl("file:///C:/secret")).toBe(false);
  expect(isPreviewUrl("https://r1.googlevideo.com/videoplayback")).toBe(true);
  expect(isPreviewUrl("https://googlevideo.com.attacker.invalid/a")).toBe(
    false,
  );
});
