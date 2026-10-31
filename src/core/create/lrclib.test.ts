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

describe("fetchSyncedLyrics: Suchfallback", () => {
  // Nutzerwunsch vom 30.07.2026: /api/get findet nur exakte Artist/Titel-
  // Paare. Die Suche liefert eine Trefferliste mit Dauer; der Dauerfilter
  // (+-2 s wie beim Get-Endpunkt) haelt die Editionsgefahr klein, und der
  // LRC-Sanity-Deckel der Pipeline bleibt als zweiter Schutz.
  const suche = (treffer: unknown[]) =>
    fake(async (url) =>
      String(url).includes("/api/search") ? antwort(treffer) : antwort({}, false),
    );

  it("faellt auf /api/search zurueck, wenn get keinen Treffer hat", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: suche([{ duration: 213, syncedLyrics: "[00:12.00]Er war ein Punker" }]),
    });
    expect(text).toBe("[00:12.00]Er war ein Punker");
  });

  it("uebergibt Artist und Titel an die Suche", async () => {
    const gesehen: string[] = [];
    await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async (url) => {
        gesehen.push(String(url));
        return String(url).includes("/api/search") ? antwort([]) : antwort({}, false);
      }),
    });
    expect(gesehen[1]).toContain("/api/search");
    expect(gesehen[1]).toContain("artist_name=Falco");
    expect(gesehen[1]).toContain("track_name=Rock+Me+Amadeus");
  });

  it("waehlt aus der Suche den synchronisierten Treffer mit der naechsten Dauer", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: suche([
        { duration: 215, syncedLyrics: "[00:01.00]weiter weg" },
        { duration: 213, plainLyrics: "nur Text" },
        { duration: 214, syncedLyrics: "[00:01.00]am naechsten" },
      ]),
    });
    expect(text).toBe("[00:01.00]am naechsten");
  });

  it("verwirft Suchtreffer mit mehr als 2 s Dauerabweichung", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: suche([{ duration: 220, syncedLyrics: "[00:01.00]andere Edition" }]),
    });
    expect(text).toBeNull();
  });

  it("ruft die Suche nicht, wenn get schon liefert", async () => {
    let aufrufe = 0;
    await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => {
        aufrufe++;
        return antwort({ syncedLyrics: "x" });
      }),
    });
    expect(aufrufe).toBe(1);
  });

  it("liefert null, wenn auch die Suche wegbricht", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async (url) => {
        if (String(url).includes("/api/search")) throw new Error("ENOTFOUND");
        return antwort({}, false);
      }),
    });
    expect(text).toBeNull();
  });
});
