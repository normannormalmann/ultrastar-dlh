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
  /** Wartezeit zwischen Wiederholungen; Tests ersetzen sie durch ein Nichts. */
  warteFn?: (ms: number) => Promise<void>;
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
  const warte = a.warteFn ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const hole = (url: string): Promise<Response> => mitWiederholung(f, url, warte);
  return (await holeExakt(a, hole)) ?? (await holeAusSuche(a, hole));
};

/**
 * lrclib.net antwortet unter Last mit 503 ServerOverloaded (gemessen am
 * 31.10.2026 auf /api/search in Serie), Sekunden spaeter trifft derselbe
 * Aufruf. Drei Versuche mit wachsender Pause; 404 und andere Antworten
 * werden nicht wiederholt, die sind eine Antwort. Netzfehler werfen
 * weiter, der Aufrufer faengt sie.
 */
const WIEDERHOLUNGEN = 3;
const PAUSEN_MS = [1000, 2000];

const mitWiederholung = async (
  f: typeof fetch,
  url: string,
  warte: (ms: number) => Promise<void>,
): Promise<Response> => {
  let antwort = await f(url, KOPF);
  for (let versuch = 1; versuch < WIEDERHOLUNGEN; versuch++) {
    if (antwort.status !== 503 && antwort.status !== 429) break;
    await warte(PAUSEN_MS[versuch - 1] ?? 2000);
    antwort = await f(url, KOPF);
  }
  return antwort;
};

/** Hoechstens so weit darf die Dauer eines Suchtreffers abweichen. */
const DAUER_TOLERANZ_S = 2;

const KOPF = {
  // lrclib.net bittet Clients, sich zu identifizieren.
  headers: {
    "User-Agent": "UltraStar-CLI (https://github.com/normannormalmann/UltraStar-CLI)",
  },
};

const holeExakt = async (
  a: LrclibAnfrage,
  hole: (url: string) => Promise<Response>,
): Promise<string | null> => {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  url.searchParams.set("duration", String(Math.round(a.durationSec)));
  try {
    const antwort = await hole(url.toString());
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { syncedLyrics?: string | null };
    return daten.syncedLyrics ? daten.syncedLyrics : null;
  } catch {
    return null;
  }
};

type Suchtreffer = { duration?: number; syncedLyrics?: string | null };

const holeAusSuche = async (
  a: LrclibAnfrage,
  hole: (url: string) => Promise<Response>,
): Promise<string | null> => {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  try {
    const antwort = await hole(url.toString());
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
