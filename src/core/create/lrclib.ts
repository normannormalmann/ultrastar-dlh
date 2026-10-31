// src/core/create/lrclib.ts
// Zweite Evidenzquelle fuer das Alignment: synchronisierte Lyrics (.lrc)
// von lrclib.net. Zuerst der exakte Get-Endpunkt (Artist, Titel, Dauer;
// der Server toleriert +-2 s). Geht der leer aus, die Suche -- sie findet
// auch Schreibvarianten von Artist und Titel, liefert aber eine Liste.
// Daraus zaehlt nur ein synchronisierter Treffer, dessen Dauer hoechstens
// 2 s abweicht (dieselbe Toleranz wie beim Get-Endpunkt): ein falsches
// .lrc setzt falsche Pfosten. Der LRC-Konfliktdeckel der Pipeline bleibt
// als zweiter Schutz gegen eine falsche Edition.
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
  const f = a.fetchFn ?? fetch;
  return (await holeExakt(a, f)) ?? (await holeAusSuche(a, f));
};

/** Hoechstens so weit darf die Dauer eines Suchtreffers abweichen. */
const DAUER_TOLERANZ_S = 2;

const KOPF = {
  // lrclib.net bittet Clients, sich zu identifizieren.
  headers: {
    "User-Agent": "UltraStar-CLI (https://github.com/normannormalmann/UltraStar-CLI)",
  },
};

const holeExakt = async (a: LrclibAnfrage, f: typeof fetch): Promise<string | null> => {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  url.searchParams.set("duration", String(Math.round(a.durationSec)));
  try {
    const antwort = await f(url.toString(), KOPF);
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { syncedLyrics?: string | null };
    return daten.syncedLyrics ? daten.syncedLyrics : null;
  } catch {
    return null;
  }
};

type Suchtreffer = { duration?: number; syncedLyrics?: string | null };

const holeAusSuche = async (a: LrclibAnfrage, f: typeof fetch): Promise<string | null> => {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  try {
    const antwort = await f(url.toString(), KOPF);
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as unknown;
    if (!Array.isArray(daten)) return null;
    // Naechste Dauer gewinnt: bei mehreren Editionen ist die mit der
    // passenden Laenge am ehesten die, zu der unser Audio gehoert.
    let bester: { abstand: number; text: string } | null = null;
    for (const t of daten as Suchtreffer[]) {
      if (!t.syncedLyrics || typeof t.duration !== "number") continue;
      const abstand = Math.abs(t.duration - a.durationSec);
      if (abstand > DAUER_TOLERANZ_S) continue;
      if (!bester || abstand < bester.abstand) bester = { abstand, text: t.syncedLyrics };
    }
    return bester?.text ?? null;
  } catch {
    return null;
  }
};
