// src/core/create/lrclib.ts
// Zweite Evidenzquelle fuer das Alignment: synchronisierte Lyrics (.lrc)
// von lrclib.net. Bewusst nur der exakte Get-Endpunkt (Artist, Titel,
// Dauer; der Server toleriert +-2 s) -- eine Fuzzy-Suche koennte die
// falsche Edition liefern, und ein falsches .lrc setzt falsche Pfosten.
//
// Reine Netzabfrage: Aufrufer ist die Erstellen-UI, und zu deren Zeitpunkt
// existiert noch kein Songverzeichnis, in das man cachen koennte. Der Text
// reist stattdessen im Job mit. Wer eine Datei braucht (das
// Bewertungsskript), schreibt sie selbst.

export type LrclibAnfrage = {
  artist: string;
  title: string;
  durationSec: number;
  /** Tests injizieren hier einen Ersatz -- nie gegen das echte Netz testen. */
  fetchFn?: typeof fetch;
};

/**
 * Holt synchronisierte Lyrics. Jeder Fehlschlag (kein Treffer, nur
 * unsynchronisierter Text, Netz weg) liefert null -- eine fehlende .lrc ist
 * nie ein Abbruchgrund, nur eine fehlende zweite Evidenzquelle.
 */
export const fetchSyncedLyrics = async (
  a: LrclibAnfrage,
): Promise<string | null> => {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  url.searchParams.set("duration", String(Math.round(a.durationSec)));

  const f = a.fetchFn ?? fetch;
  try {
    const antwort = await f(url.toString(), {
      // lrclib.net bittet Clients, sich zu identifizieren.
      headers: {
        "User-Agent":
          "UltraStar-CLI (https://github.com/normannormalmann/UltraStar-CLI)",
      },
    });
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { syncedLyrics?: string | null };
    return daten.syncedLyrics ? daten.syncedLyrics : null;
  } catch {
    return null;
  }
};
