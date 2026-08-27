import { describe, expect, it, test } from "bun:test";
import {
  applyHeader,
  applyVideoGap,
  categorizeRepairError,
  parseTxtHeaders,
} from "./repairSongs.ts";

test("parses ARTIST and TITLE headers", () => {
  const content = "#ARTIST:ABBA\n#TITLE:Waterloo\n#MP3:song.mp3\n: 0 4 0 Wa";
  expect(parseTxtHeaders(content)).toEqual({
    artist: "ABBA",
    title: "Waterloo",
  });
});

test("uppercases header keys (lowercase headers in file)", () => {
  const content = "#artist:Nena\n#title:99 Luftballons";
  expect(parseTxtHeaders(content)).toEqual({
    artist: "Nena",
    title: "99 Luftballons",
  });
});

test("handles CRLF line endings and surrounding whitespace", () => {
  const content = "#ARTIST:Falco\r\n#TITLE:Rock Me Amadeus\r\n";
  expect(parseTxtHeaders(content)).toEqual({
    artist: "Falco",
    title: "Rock Me Amadeus",
  });
});

test("returns empty object when headers are missing", () => {
  expect(parseTxtHeaders("no headers here")).toEqual({});
});

test("parses extended metadata headers", () => {
  const content = [
    "#ARTIST:ABBA",
    "#TITLE:Waterloo",
    "#LANGUAGE:English",
    "#GENRE:Pop",
    "#EDITION:SingStar",
    "#CREATOR:someone",
    "#YEAR:1974",
    "#BPM:294,5",
    ": 0 4 0 Wa",
  ].join("\n");
  expect(parseTxtHeaders(content)).toEqual({
    artist: "ABBA",
    title: "Waterloo",
    language: "English",
    genre: "Pop",
    edition: "SingStar",
    creator: "someone",
    year: 1974,
    bpm: 294.5,
  });
});

test("ignores invalid numbers and stops at the note block", () => {
  const content = "#ARTIST:X\n#YEAR:unknown\n: 0 4 0 La\n#GENRE:Pop";
  expect(parseTxtHeaders(content)).toEqual({ artist: "X" });
});

test("applyVideoGap replaces existing #VIDEOGAP line", () => {
  const txt = "#ARTIST:X\n#VIDEOGAP:10.0\n#BPM:120\n: 0 4 0 La\n";
  expect(applyVideoGap(txt, "37.5")).toBe(
    "#ARTIST:X\n#VIDEOGAP:37.5\n#BPM:120\n: 0 4 0 La\n",
  );
});

test("applyVideoGap inserts after first header when absent", () => {
  const txt = "#ARTIST:X\n#TITLE:Y\n#BPM:120\n: 0 4 0 La\n";
  expect(applyVideoGap(txt, "37.5")).toBe(
    "#ARTIST:X\n#VIDEOGAP:37.5\n#TITLE:Y\n#BPM:120\n: 0 4 0 La\n",
  );
});

test("applyVideoGap preserves CRLF line endings on insert", () => {
  const txt = "#ARTIST:X\r\n#TITLE:Y\r\n: 0 4 0 La\r\n";
  const out = applyVideoGap(txt, "37.5");
  expect(out).toBe("#ARTIST:X\r\n#VIDEOGAP:37.5\r\n#TITLE:Y\r\n: 0 4 0 La\r\n");
});

test("applyHeader replaces and inserts arbitrary headers", () => {
  const txt = "#ARTIST:X\n#GENRE:Old\n: 0 4 0 La\n";
  expect(applyHeader(txt, "GENRE", "Pop")).toBe(
    "#ARTIST:X\n#GENRE:Pop\n: 0 4 0 La\n",
  );
  const noGenre = "#ARTIST:X\r\n: 0 4 0 La\r\n";
  expect(applyHeader(noGenre, "GENRE", "Pop")).toBe(
    "#ARTIST:X\r\n#GENRE:Pop\r\n: 0 4 0 La\r\n",
  );
});

describe("categorizeRepairError", () => {
  const typ = (nachricht: string): string =>
    categorizeRepairError(new Error(nachricht)).type;

  it("names YouTube's bot protection instead of shrugging", () => {
    // The single most common repair failure, and the one with an actual
    // remedy: pick a signed-in browser and close it.
    expect(
      typ(
        "YouTube bot protection blocked the download. Please ensure you are logged into YouTube.",
      ),
    ).toBe("bot_protection");
    expect(typ("ERROR: Sign in to confirm you are not a bot")).toBe(
      "bot_protection",
    );
  });

  it("separates a dead video from a missing link", () => {
    // Different remedies: one is gone for good, the other may be findable.
    expect(typ("ERROR: Video unavailable")).toBe("video_unavailable");
    expect(typ("ERROR: Private video")).toBe("video_unavailable");
    expect(typ("No video link found")).toBe("no_link");
  });

  it("keeps the transport failures apart", () => {
    expect(typ("getaddrinfo ENOTFOUND youtube.com")).toBe("network_error");
    expect(typ("HTTP 429 Too Many Requests")).toBe("rate_limit");
    expect(typ("HTTP 401 Unauthorized")).toBe("auth_error");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(typ("yt-dlp exited with code 1")).toBe("unknown");
  });
});
