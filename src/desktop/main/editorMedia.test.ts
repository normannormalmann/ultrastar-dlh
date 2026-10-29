// src/desktop/main/editorMedia.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mimeFor,
  parseRange,
  registerMedia,
  resolveMediaToken,
  serveMedia,
} from "./editorMedia.ts";

describe("parseRange", () => {
  it("liest offene, geschlossene und Suffix-Bereiche", () => {
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
  });

  it("antwortet ohne oder mit unbekanntem Header ganz", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });

  it("erkennt unerfuellbare Bereiche", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=20-10", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
  });
});

describe("Token", () => {
  it("loest nur ausgegebene Token auf", () => {
    const url = registerMedia("C:\\songs\\a.mp3");
    expect(resolveMediaToken(url)).toBe("C:\\songs\\a.mp3");
    expect(resolveMediaToken("songmedia://media/../../etc/passwd")).toBeNull();
    expect(
      resolveMediaToken("songmedia://media/00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("vergisst alte Token", () => {
    const erste = registerMedia("erste.mp3");
    for (let i = 0; i < 4; i += 1) registerMedia(`n${i}.mp3`);
    expect(resolveMediaToken(erste)).toBeNull();
  });

  it("kennt die gaengigen Medientypen", () => {
    expect(mimeFor("x/video.MP4")).toBe("video/mp4");
    expect(mimeFor("audio.mp3")).toBe("audio/mpeg");
  });
});

describe("serveMedia", () => {
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "media-"));
    await writeFile(join(dir, "a.mp3"), "0123456789");
    url = registerMedia(join(dir, "a.mp3"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert einen Bereich mit 206", async () => {
    const r = await serveMedia(new Request(url, { headers: { range: "bytes=2-4" } }));
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await r.text()).toBe("234");
  });

  it("liefert ohne Range die ganze Datei", async () => {
    const r = await serveMedia(new Request(url));
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(await r.text()).toBe("0123456789");
  });

  it("antwortet 416 auf unerfuellbare Bereiche und 404 auf fremde Token", async () => {
    const r = await serveMedia(new Request(url, { headers: { range: "bytes=50-" } }));
    expect(r.status).toBe(416);
    const fremd = await serveMedia(
      new Request("songmedia://media/00000000-0000-0000-0000-000000000000"),
    );
    expect(fremd.status).toBe(404);
  });
});
