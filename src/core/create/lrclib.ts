// src/core/create/lrclib.ts
// Zweite Evidenzquelle fuer das Alignment: synchronisierte Lyrics (.lrc)
// von lrclib.net. Bewusst nur der exakte Get-Endpunkt (Artist, Titel,
// Dauer; der Server toleriert +-2 s) -- eine Fuzzy-Suche koennte die
// falsche Edition liefern, und ein falsches .lrc setzt falsche Pfosten.
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LrclibAnfrage = {
  artist: string;
  title: string;
  durationSec: number;
  songDir: string;
  /** Tests injizieren hier einen Ersatz -- nie gegen das echte Netz testen. */
  fetchFn?: typeof fetch;
};

const CACHE_DATEI = "synced-lyrics.lrc";

/** Pfad zur gecachten .lrc im Songverzeichnis, ohne Netzzugriff. */
export const cachedLyricsPfad = async (songDir: string): Promise<string | null> => {
  const pfad = join(songDir, CACHE_DATEI);
  try {
    await access(pfad);
    return pfad;
  } catch {
    return null;
  }
};

/**
 * Holt synchronisierte Lyrics und cached Treffer im Songverzeichnis.
 * Jeder Fehlschlag (kein Treffer, nur unsynchronisierter Text, Netz weg)
 * liefert null -- eine fehlende .lrc ist nie ein Abbruchgrund, nur eine
 * fehlende zweite Evidenzquelle.
 */
export const holeSyncedLyrics = async (a: LrclibAnfrage): Promise<string | null> => {
  const imCache = await cachedLyricsPfad(a.songDir);
  if (imCache) return imCache;

  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  url.searchParams.set("duration", String(Math.round(a.durationSec)));

  const f = a.fetchFn ?? fetch;
  try {
    const antwort = await f(url.toString(), {
      // lrclib.net bittet Clients, sich zu identifizieren.
      headers: { "User-Agent": "UltraStar-CLI (https://github.com/normannormalmann/UltraStar-CLI)" },
    });
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { syncedLyrics?: string | null };
    if (!daten.syncedLyrics) return null;
    const pfad = join(a.songDir, CACHE_DATEI);
    await writeFile(pfad, daten.syncedLyrics, "utf8");
    return pfad;
  } catch {
    return null;
  }
};
