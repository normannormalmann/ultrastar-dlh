// src/desktop/renderer/views/createDraft.ts
// The wizard's rules, deliberately without React and without the DOM: this is
// the part worth testing, and the project has no component test setup. The
// five step components only display and report changes.
import type { CreateJob } from "../../../core/create/job.ts";
import {
  type Antwort,
  normalizeLyrics,
  resolveLyrics,
} from "../../../core/create/lyrics.ts";
import type { DownloadedEntry, MediaQuelle } from "../../shared/ipcContract.ts";

export type Schritt = 1 | 2 | 3 | 4 | 5;

export type Entwurf = {
  /** Created in step 1 already: step 4 keys its image cache by it. */
  id: string;
  artist: string;
  title: string;
  language: string;
  /** Free text while drafting; parsed only in zuJob(). */
  genre: string;
  year: string;
  bpm: string;
  quelle: MediaQuelle | null;
  durationSec: number | null;
  /** From the search hit - step 4 needs it, the job does not. */
  thumbnailUrl: string | null;
  rohtext: string;
  antworten: Antwort[];
  /** LRCLIB's hit, as long as the user kept it unchanged. */
  syncedText: string | null;
  coverWahl: { pfad: string } | "keins" | null;
};

export const leererEntwurf = (id: string): Entwurf => ({
  id,
  artist: "",
  title: "",
  language: "Deutsch",
  genre: "",
  year: "",
  bpm: "",
  quelle: null,
  durationSec: null,
  thumbnailUrl: null,
  rohtext: "",
  antworten: [],
  syncedText: null,
  coverWahl: null,
});

export type Pruefung = { ok: true } | { ok: false; grund: string };

export const offeneFragenZahl = (e: Entwurf): number => {
  const fragen = normalizeLyrics(e.rohtext).offeneFragen;
  const beantwortet = new Set(e.antworten.map((a) => a.zeilenIndex));
  return fragen.filter((f) => !beantwortet.has(f.zeilenIndex)).length;
};

export const schrittFertig = (e: Entwurf, s: Schritt): Pruefung => {
  if (s === 1) {
    const fehltInterpret = e.artist.trim().length === 0;
    const fehltTitel = e.title.trim().length === 0;
    if (fehltInterpret && fehltTitel) {
      return { ok: false, grund: "Interpret und Titel fehlen." };
    }
    if (fehltInterpret) return { ok: false, grund: "Interpret fehlt." };
    if (fehltTitel) return { ok: false, grund: "Titel fehlt." };
    if (e.language.trim().length === 0) {
      return { ok: false, grund: "Sprache fehlt." };
    }
    return { ok: true };
  }
  if (s === 2) {
    if (e.quelle === null) {
      return { ok: false, grund: "Keine Quelle gewaehlt." };
    }
    return { ok: true };
  }
  if (s === 3) {
    if (e.rohtext.trim().length === 0) {
      return { ok: false, grund: "Kein Liedtext eingefuegt." };
    }
    const offen = offeneFragenZahl(e);
    if (offen > 0) {
      return {
        ok: false,
        grund: `Noch ${offen} offene Rueckfrage${
          offen === 1 ? "" : "n"
        } zum Text.`,
      };
    }
    if (resolveLyrics(e.rohtext, e.antworten).length === 0) {
      return {
        ok: false,
        grund: "Nach dem Aufbereiten bleibt keine Zeile uebrig.",
      };
    }
    return { ok: true };
  }
  if (s === 4) {
    if (e.coverWahl === null) {
      return { ok: false, grund: "Noch keine Bildentscheidung." };
    }
    return { ok: true };
  }
  return { ok: true };
};

const zahlOderUndefined = (roh: string): number | undefined => {
  const wert = Number.parseInt(roh.trim(), 10);
  return Number.isFinite(wert) && wert > 0 ? wert : undefined;
};

/** Throws rather than shipping half a job: the view gates on schrittFertig. */
export const zuJob = (e: Entwurf): CreateJob => {
  for (const s of [1, 2, 3, 4] as const) {
    const p = schrittFertig(e, s);
    if (!p.ok) throw new Error(p.grund);
  }
  if (e.quelle === null) throw new Error("Keine Quelle gewaehlt.");
  const job: CreateJob = {
    id: e.id,
    quelle: e.quelle,
    language: e.language.trim(),
    artist: e.artist.trim(),
    title: e.title.trim(),
    lyricsText: resolveLyrics(e.rohtext, e.antworten).join("\n"),
  };
  if (e.syncedText) job.syncedLyricsText = e.syncedText;
  if (e.coverWahl !== null) job.coverWahl = e.coverWahl;
  const genre = e.genre.trim();
  if (genre.length > 0) job.genre = genre;
  const jahr = zahlOderUndefined(e.year);
  if (jahr !== undefined) job.year = jahr;
  const bpm = zahlOderUndefined(e.bpm);
  if (bpm !== undefined) job.bpm = bpm;
  return job;
};

const schluessel = (artist: string, title: string): string =>
  `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

/**
 * A warning, not a veto: freierZielpfad deliberately puts "Titel (2)" next to
 * the existing folder, and the user is allowed to want exactly that.
 */
export const istDuplikat = (
  e: Entwurf,
  downloaded: DownloadedEntry[],
): boolean => {
  const gesucht = schluessel(e.artist, e.title);
  return downloaded.some((d) => schluessel(d.artist, d.title) === gesucht);
};
