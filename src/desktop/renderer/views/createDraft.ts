// src/desktop/renderer/views/createDraft.ts
// The wizard's rules, deliberately without React and without the DOM: this is
// the part worth testing, and the project has no component test setup. The
// five step components only display and report changes.
import type { CreateJob } from "../../../core/create/job.ts";
import { istBekannteSprache } from "../../../core/create/languages.ts";
import {
  type Antwort,
  normalizeLyrics,
  resolveLyrics,
} from "../../../core/create/lyrics.ts";
import type { DownloadedEntry, MediaQuelle } from "../../shared/ipcContract.ts";

export type Schritt = 1 | 2 | 3 | 4 | 5;

// Re-exported so the step components have one import for the wizard's rules.
// The table itself lives in core: the same list feeds the #LANGUAGE tag in
// writeSongTxt, and the renderer must not own what the core writes.
export { SPRACHEN, spracheName } from "../../../core/create/languages.ts";

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
  language: "de",
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

/**
 * Why a step is not done yet. A code rather than a sentence: this module is
 * pure logic and must not know which language the UI happens to speak.
 * The catalog turns these into text.
 */
export type PruefGrund =
  | "artistAndTitleMissing"
  | "artistMissing"
  | "titleMissing"
  | "languageMissing"
  | "languageModelMissing"
  | "noSource"
  | "noLyrics"
  | "openQuestions"
  | "noLineLeft"
  | "noCoverChoice";

export type Pruefung =
  | { ok: true }
  /** anzahl is only set for openQuestions. */
  | { ok: false; grund: PruefGrund; anzahl?: number };

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
      return { ok: false, grund: "artistAndTitleMissing" };
    }
    if (fehltInterpret) return { ok: false, grund: "artistMissing" };
    if (fehltTitel) return { ok: false, grund: "titleMissing" };
    if (e.language.trim().length === 0) {
      return { ok: false, grund: "languageMissing" };
    }
    // Blocked here rather than in the pipeline: there it costs the model
    // loading time first and only then says language_unsupported.
    if (!istBekannteSprache(e.language)) {
      return { ok: false, grund: "languageModelMissing" };
    }
    return { ok: true };
  }
  if (s === 2) {
    if (e.quelle === null) {
      return { ok: false, grund: "noSource" };
    }
    return { ok: true };
  }
  if (s === 3) {
    if (e.rohtext.trim().length === 0) {
      return { ok: false, grund: "noLyrics" };
    }
    const offen = offeneFragenZahl(e);
    if (offen > 0) {
      return { ok: false, grund: "openQuestions", anzahl: offen };
    }
    if (resolveLyrics(e.rohtext, e.antworten).length === 0) {
      return { ok: false, grund: "noLineLeft" };
    }
    return { ok: true };
  }
  if (s === 4) {
    if (e.coverWahl === null) {
      return { ok: false, grund: "noCoverChoice" };
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
    if (!p.ok) throw new Error(`Draft incomplete: ${p.grund}`);
  }
  if (e.quelle === null) throw new Error("Draft incomplete: noSource");
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
