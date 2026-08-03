import { describe, expect, it } from "bun:test";
import { fetchSyncedLyrics } from "./lrclib.ts";

const antwort = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as unknown as Response;

// Bun's `typeof fetch` also carries `preconnect`; an attrappe only needs the
// call signature. Same cast as in coverArtArchive.test.ts and media.test.ts.
const fake = (
  f: (url: string | URL | Request) => Promise<Response>,
): typeof fetch => f as unknown as typeof fetch;

const anfrage = {
  artist: "Falco",
  title: "Rock Me Amadeus",
  durationSec: 213.4,
};

describe("fetchSyncedLyrics", () => {
  it("liefert die synchronisierten Lyrics", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () =>
        antwort({ syncedLyrics: "[00:12.00]Er war ein Punker" }),
      ),
    });
    expect(text).toBe("[00:12.00]Er war ein Punker");
  });

  it("rundet die Dauer auf ganze Sekunden", async () => {
    let gesehen = "";
    await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async (url) => {
        gesehen = String(url);
        return antwort({ syncedLyrics: "x" });
      }),
    });
    expect(gesehen).toContain("duration=213");
    expect(gesehen).toContain("artist_name=Falco");
  });

  it("liefert null ohne synchronisierte Lyrics", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => antwort({ plainLyrics: "ohne Zeitstempel" })),
    });
    expect(text).toBeNull();
  });

  it("liefert null bei 404", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => antwort({}, false)),
    });
    expect(text).toBeNull();
  });

  it("liefert null, wenn das Netz wegbricht", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => {
        throw new Error("ENOTFOUND");
      }),
    });
    expect(text).toBeNull();
  });
});
