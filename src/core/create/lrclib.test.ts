// src/core/create/lrclib.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { cachedLyricsPfad, holeSyncedLyrics } from "./lrclib.ts";

const tempDir = () => mkdtemp(join(tmpdir(), "lrclib-test-"));

const fakeFetch = (
  aufrufe: string[],
  antwort: () => Response,
): typeof fetch =>
  (async (eingabe: RequestInfo | URL) => {
    aufrufe.push(String(eingabe));
    return antwort();
  }) as typeof fetch;

describe("holeSyncedLyrics", () => {
  it("cached einen Treffer im Songverzeichnis und liefert den Pfad", async () => {
    const dir = await tempDir();
    const aufrufe: string[] = [];
    const pfad = await holeSyncedLyrics({
      artist: "Kuenstler",
      title: "Titel",
      durationSec: 180.4,
      songDir: dir,
      fetchFn: fakeFetch(aufrufe, () =>
        Response.json({ syncedLyrics: "[00:12.00]erste zeile" }),
      ),
    });
    expect(pfad).toBe(join(dir, "synced-lyrics.lrc"));
    expect(await readFile(pfad as string, "utf8")).toBe("[00:12.00]erste zeile");
    // Der Get-Endpunkt bekommt die exakte Signatur, Dauer gerundet.
    expect(aufrufe[0]).toContain("artist_name=K");
    expect(aufrufe[0]).toContain("duration=180");
  });

  it("liefert null bei 404 und cached nichts", async () => {
    const dir = await tempDir();
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: fakeFetch([], () => new Response("not found", { status: 404 })),
    });
    expect(pfad).toBeNull();
    expect(await cachedLyricsPfad(dir)).toBeNull();
  });

  it("liefert null, wenn nur unsynchronisierte Lyrics existieren", async () => {
    const dir = await tempDir();
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: fakeFetch([], () => Response.json({ syncedLyrics: null, plainLyrics: "text" })),
    });
    expect(pfad).toBeNull();
  });

  it("liefert null bei Netzfehler statt zu werfen", async () => {
    const dir = await tempDir();
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    expect(pfad).toBeNull();
  });

  it("nutzt den Cache ohne weiteren Netzzugriff", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "synced-lyrics.lrc"), "[00:01.00]zeile", "utf8");
    const aufrufe: string[] = [];
    const pfad = await holeSyncedLyrics({
      artist: "a", title: "b", durationSec: 100, songDir: dir,
      fetchFn: fakeFetch(aufrufe, () => Response.json({})),
    });
    expect(pfad).toBe(join(dir, "synced-lyrics.lrc"));
    expect(aufrufe).toEqual([]);
    expect(await cachedLyricsPfad(dir)).toBe(pfad);
  });
});
