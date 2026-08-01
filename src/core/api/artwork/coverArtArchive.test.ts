import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { findCover } from "./coverArtArchive.ts";

const fakeFetch = (routen: Record<string, unknown>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input);
    const treffer = Object.keys(routen).find((k) => url.includes(k));
    if (!treffer) return new Response("nicht gefunden", { status: 404 });
    const wert = routen[treffer];
    if (wert instanceof Uint8Array) {
      // Cast: TS types BodyInit as Uint8Array<ArrayBuffer>, the literal
      // here is Uint8Array<ArrayBufferLike>. Same bytes at runtime.
      return new Response(wert as unknown as BodyInit, { status: 200 });
    }
    return new Response(JSON.stringify(wert), { status: 200 });
  }) as unknown as typeof fetch;

describe("findCover", () => {
  it("liefert die Bilddaten bei eindeutigem Treffer", async () => {
    const bild = new Uint8Array([1, 2, 3]);
    const f = fakeFetch({
      "musicbrainz.org": {
        recordings: [{ score: 97, releases: [{ id: "rel-1" }] }],
      },
      "coverartarchive.org/release/rel-1/front": bild,
    });
    const ergebnis = await Effect.runPromise(findCover("Interpret", "Titel", f));
    expect(ergebnis).toEqual(bild);
  });

  it("verwirft unsichere Treffer statt ein falsches Cover zu liefern", async () => {
    const f = fakeFetch({
      "musicbrainz.org": {
        recordings: [{ score: 62, releases: [{ id: "rel-1" }] }],
      },
    });
    expect(await Effect.runPromise(findCover("A", "B", f))).toBeNull();
  });

  it("liefert null statt zu werfen, wenn das Netz ausfaellt", async () => {
    const f = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await Effect.runPromise(findCover("A", "B", f))).toBeNull();
  });

  it("liefert null, wenn die Aufnahme keine Veroeffentlichung hat", async () => {
    const f = fakeFetch({
      "musicbrainz.org": { recordings: [{ score: 99, releases: [] }] },
    });
    expect(await Effect.runPromise(findCover("A", "B", f))).toBeNull();
  });
});
