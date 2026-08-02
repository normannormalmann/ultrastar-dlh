import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { acquireMedia, videoIdAusLink } from "./media.ts";

const jobDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "media-test-"));

describe("videoIdAusLink", () => {
  it("erkennt die drei gebraeuchlichen Linkformen", () => {
    expect(videoIdAusLink("https://youtu.be/abc12345678")).toBe("abc12345678");
    expect(videoIdAusLink("https://www.youtube.com/watch?v=abc12345678")).toBe(
      "abc12345678",
    );
    expect(videoIdAusLink("https://www.youtube.com/embed/abc12345678")).toBe(
      "abc12345678",
    );
  });

  it("liefert null bei fremden Adressen", () => {
    expect(videoIdAusLink("https://example.com/x")).toBeNull();
  });
});

describe("acquireMedia", () => {
  it("laedt Video, extrahiert die Tonspur und holt das Thumbnail", async () => {
    const dir = await jobDir();
    const ffmpegAufrufe: string[][] = [];
    const ergebnis = await Effect.runPromise(
      acquireMedia({
        quelle: { kind: "youtube", url: "https://youtu.be/abc12345678" },
        jobDir: dir,
        deps: {
          downloadVideo: (_link, ziel) =>
            Effect.promise(async () => {
              await writeFile(ziel, "video");
            }),
          runFfmpeg: async (args) => {
            ffmpegAufrufe.push(args);
            await writeFile(args[args.length - 1] as string, "audio");
          },
          fetchFn: (async () =>
            new Response(new Uint8Array([9, 9]), {
              status: 200,
            })) as unknown as typeof fetch,
        },
      }),
    );
    expect(ergebnis.videoPath).toBe(join(dir, "video.mp4"));
    expect(ergebnis.audioPath).toBe(join(dir, "audio.m4a"));
    expect(ergebnis.coverKandidat).toBe(join(dir, "thumbnail.jpg"));
    expect(await readFile(join(dir, "thumbnail.jpg"))).toEqual(
      Buffer.from([9, 9]),
    );
    expect(ffmpegAufrufe).toHaveLength(1);
  });

  it("ein fehlendes Thumbnail ist kein Fehler", async () => {
    const dir = await jobDir();
    const ergebnis = await Effect.runPromise(
      acquireMedia({
        quelle: { kind: "youtube", url: "https://youtu.be/abc12345678" },
        jobDir: dir,
        deps: {
          downloadVideo: (_l, ziel) =>
            Effect.promise(async () => {
              await writeFile(ziel, "video");
            }),
          runFfmpeg: async (args) => {
            await writeFile(args[args.length - 1] as string, "audio");
          },
          fetchFn: (async () =>
            new Response("weg", { status: 404 })) as unknown as typeof fetch,
        },
      }),
    );
    expect(ergebnis.coverKandidat).toBeUndefined();
    expect(ergebnis.audioPath).toBe(join(dir, "audio.m4a"));
  });

  it("meldet einen gescheiterten Download typisiert", async () => {
    const dir = await jobDir();
    const fehler = await Effect.runPromise(
      Effect.either(
        acquireMedia({
          quelle: { kind: "youtube", url: "https://youtu.be/abc12345678" },
          jobDir: dir,
          deps: {
            downloadVideo: () => Effect.fail(new Error("yt-dlp weg")),
            runFfmpeg: async () => {},
          },
        }),
      ),
    );
    expect(fehler._tag).toBe("Left");
    if (fehler._tag === "Left") {
      expect(fehler.left.kind).toBe("DownloadFailed");
    }
  });

  it("meldet einen Abbruch typisiert, statt weiterzulaufen", async () => {
    const dir = await jobDir();
    const controller = new AbortController();
    controller.abort();
    const fehler = await Effect.runPromise(
      Effect.either(
        acquireMedia({
          quelle: { kind: "youtube", url: "https://youtu.be/abc12345678" },
          jobDir: dir,
          signal: controller.signal,
          deps: {
            downloadVideo: (_l, ziel) =>
              Effect.promise(async () => {
                await writeFile(ziel, "video");
              }),
            runFfmpeg: async () => {},
          },
        }),
      ),
    );
    expect(fehler._tag).toBe("Left");
    if (fehler._tag === "Left") expect(fehler.left.kind).toBe("Cancelled");
  });

  it("reicht eine lokale Datei durch und zieht ihr eingebettetes Bild", async () => {
    const dir = await jobDir();
    const quelle = join(dir, "eigene.mp3");
    await writeFile(quelle, "ton");
    const ergebnis = await Effect.runPromise(
      acquireMedia({
        quelle: { kind: "datei", pfad: quelle },
        jobDir: dir,
        deps: {
          runFfmpeg: async (args) => {
            await writeFile(args[args.length - 1] as string, "bild");
          },
        },
      }),
    );
    expect(ergebnis.audioPath).toBe(quelle);
    expect(ergebnis.videoPath).toBeUndefined();
    expect(ergebnis.coverKandidat).toBe(join(dir, "embedded.jpg"));
  });

  it("meldet eine unlesbare lokale Datei", async () => {
    const dir = await jobDir();
    const fehler = await Effect.runPromise(
      Effect.either(
        acquireMedia({
          quelle: { kind: "datei", pfad: join(dir, "gibtsnicht.mp3") },
          jobDir: dir,
          deps: { runFfmpeg: async () => {} },
        }),
      ),
    );
    expect(fehler._tag).toBe("Left");
    if (fehler._tag === "Left") {
      expect(fehler.left.kind).toBe("UnreadableFile");
    }
  });
});
