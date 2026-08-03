// src/desktop/main/coverCandidates.test.ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { holeCoverKandidatenIn, raeumeWaisenIn } from "./coverCandidates.ts";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/**
 * The repo's usual cast (see coverArtArchive.test.ts): Bun's `typeof fetch`
 * also carries `preconnect`, so a bare async function is not assignable.
 */
const fakeFetch = (antwort: () => Response): typeof fetch =>
  (async () => antwort()) as unknown as typeof fetch;

const mitBytes = (): Response =>
  new Response(jpeg as unknown as BodyInit, { status: 200 });

describe("holeCoverKandidatenIn", () => {
  it("legt beide Kandidaten ab und liefert Data-URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Falco",
      title: "Rock Me Amadeus",
      thumbnailUrl: "https://example.invalid/t.jpg",
      deps: {
        findCoverFn: () => Effect.succeed(jpeg),
        fetchFn: fakeFetch(mitBytes),
      },
    });
    expect(kandidaten.map((k) => k.kind)).toEqual(["caa", "thumbnail"]);
    expect(kandidaten[0]?.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(
      true,
    );
    expect((await readFile(kandidaten[0]?.pfad ?? "")).length).toBe(jpeg.length);
    expect((await readFile(kandidaten[1]?.pfad ?? "")).length).toBe(jpeg.length);
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert nur den Thumbnail, wenn das Archiv leer ist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Nische",
      title: "Unbekannt",
      thumbnailUrl: "https://example.invalid/t.jpg",
      deps: {
        findCoverFn: () => Effect.succeed(null),
        fetchFn: fakeFetch(mitBytes),
      },
    });
    expect(kandidaten.map((k) => k.kind)).toEqual(["thumbnail"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert eine leere Liste, wenn beide Quellen versagen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Nische",
      title: "Unbekannt",
      deps: { findCoverFn: () => Effect.succeed(null) },
    });
    expect(kandidaten).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("ueberspringt einen Thumbnail, den der Server verweigert", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Nische",
      title: "Unbekannt",
      thumbnailUrl: "https://example.invalid/t.jpg",
      deps: {
        findCoverFn: () => Effect.succeed(null),
        fetchFn: fakeFetch(() => new Response("weg", { status: 404 })),
      },
    });
    expect(kandidaten).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("raeumeWaisenIn", () => {
  it("loescht nur unbekannte Job-Ordner", async () => {
    const wurzel = await mkdtemp(join(tmpdir(), "cover-root-"));
    await Bun.write(join(wurzel, "behalten", "caa.jpg"), "x");
    await Bun.write(join(wurzel, "weg", "caa.jpg"), "x");
    await raeumeWaisenIn(wurzel, ["behalten"]);
    expect(await Bun.file(join(wurzel, "behalten", "caa.jpg")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(wurzel, "weg", "caa.jpg")).exists()).toBe(false);
    await rm(wurzel, { recursive: true, force: true });
  });

  it("stoert sich nicht an einem fehlenden Cache", async () => {
    await raeumeWaisenIn(join(tmpdir(), "gibt-es-nicht-12345"), []);
  });
});
