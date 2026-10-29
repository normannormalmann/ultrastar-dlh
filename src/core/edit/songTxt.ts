// src/core/edit/songTxt.ts
// Parses an existing UltraStar song.txt into an editable model and writes it
// back. Unlike writeSongTxt.ts this has to round-trip files it did not
// write: headers keep their order and spelling, unknown headers survive.
//
// Beats are always absolute in the model. A RELATIVE file is converted on
// reading and converted back on writing, so every edit works the same way.

/** ":" normal, "*" golden, "F" freestyle, "R" rap, "G" golden rap. */
export type NoteType = ":" | "*" | "F" | "R" | "G";

export const NOTE_TYPES: readonly NoteType[] = [":", "*", "F", "R", "G"];

/**
 * Why the creation pipeline doubted a note: "interpolated" means its timing
 * was guessed between measured words, "low" that the measurement was weak.
 * Not part of the .txt - it lives in sync-hints.json next to it.
 */
export type UnsureKind = "interpolated" | "low";

export const UNSURE_KINDS: readonly UnsureKind[] = ["interpolated", "low"];

export type LineBreakMark = { beat: number; end?: number };

export type EditNote = {
  type: NoteType;
  beat: number;
  length: number;
  pitch: number;
  /** Verbatim, including a leading space or "~" - both carry meaning. */
  syllable: string;
  /** The "- beat" line that follows this note, if any. */
  breakAfter?: LineBreakMark;
  unsure?: UnsureKind;
};

/** Anything with notes: a track, or a test fixture. The edit functions take this. */
export type NoteSeq = { notes: EditNote[] };

/**
 * One singer's part. A normal song has one track without marker; a duet
 * has one per "P1"/"P2" line, the marker kept as written.
 */
export type Track = NoteSeq & { marker?: string };

export type HeaderLine = { key: string; value: string };

export type SongTxt = {
  headers: HeaderLine[];
  tracks: Track[];
  eol: "\n" | "\r\n";
  /** Lines after "E" - ignored by games, but someone's notes; kept verbatim. */
  trailer?: string[];
  /** The file is in RELATIVE format and is written back as such. */
  relative?: boolean;
};

/**
 * Codes, not sentences: the renderer translates them, the main process
 * stays language-free.
 */
export type SongTxtErrorCode =
  | "noNotes"
  | "badLine"
  | "badHeader"
  | "badValue";

export class SongTxtError extends Error {
  constructor(
    readonly code: SongTxtErrorCode,
    readonly line?: number,
  ) {
    super(line === undefined ? `songTxt: ${code}` : `songTxt: ${code} (Zeile ${line})`);
  }
}

/** Written as an escape: a literal BOM in source is invisible in every editor. */
export const BOM = String.fromCharCode(0xfeff);

const NOTE_LINE = /^([:*FRG])[ \t]+(-?\d+)[ \t]+(-?\d+)[ \t]+(-?\d+)(?:[ \t](.*))?$/;
const BREAK_LINE = /^-[ \t]*(-?\d+)(?:[ \t]+(-?\d+))?[ \t]*$/;
const HEADER_LINE = /^#([^:]+):(.*)$/;
/** One rule for reading and writing: whatever the parser accepts, the writer takes back. */
const HEADER_KEY = /^[^:#\r\n]+$/;
const MARKER_LINE = /^P[ \t]*\d+$/;

/** "P1" and "P 1" are the same singer. */
const markerKey = (marker: string): string => marker.replace(/\s/g, "");

const istRelativ = (headers: HeaderLine[]): boolean =>
  headers.some(
    (h) => h.key.toUpperCase() === "RELATIVE" && h.value.trim().toUpperCase() === "YES",
  );

/** A break after a track's very last note would land right before "E". */
const ohneSchlussUmbruch = (t: Track): Track => {
  const letzte = t.notes[t.notes.length - 1];
  if (!letzte?.breakAfter) return t;
  const { breakAfter: _, ...rest } = letzte;
  return { ...t, notes: [...t.notes.slice(0, -1), rest] };
};

export const parseSongTxt = (text: string): SongTxt => {
  const ohneBom = text.startsWith(BOM) ? text.slice(1) : text;
  const eol = ohneBom.includes("\r\n") ? "\r\n" : "\n";
  const zeilen = ohneBom.split(/\r?\n/);

  const headers: HeaderLine[] = [];
  const tracks: Track[] = [];
  const trailer: string[] = [];
  let imKoerper = false;
  let relativ = false;
  // RELATIVE: beats count from the start of the current line. Each singer
  // keeps their own count, as in USDX - a second "P1" block goes on from
  // where the first one stopped.
  let basis = 0;
  let marker = "";
  const basen = new Map<string, number>();

  const aktuelleSpur = (): Track => {
    if (tracks.length === 0) tracks.push({ notes: [] });
    return tracks[tracks.length - 1] as Track;
  };

  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i] as string;
    const nr = i + 1;
    if (zeile.trim() === "") continue;

    if (!imKoerper && zeile.startsWith("#")) {
      const m = HEADER_LINE.exec(zeile);
      // Spelling kept as written; lookups compare case-insensitively.
      const key = m ? (m[1] as string).trim() : "";
      if (!m || !HEADER_KEY.test(key)) throw new SongTxtError("badHeader", nr);
      headers.push({ key, value: m[2] as string });
      continue;
    }
    if (!imKoerper) relativ = istRelativ(headers);
    imKoerper = true;

    const getrimmt = zeile.trim();
    if (getrimmt === "E") {
      const rest = zeilen.slice(i + 1);
      while (rest.length > 0 && (rest[rest.length - 1] as string).trim() === "") {
        rest.pop();
      }
      trailer.push(...rest);
      break;
    }

    if (MARKER_LINE.test(getrimmt)) {
      tracks.push({ marker: getrimmt, notes: [] });
      basen.set(marker, basis);
      marker = markerKey(getrimmt);
      basis = basen.get(marker) ?? 0;
      continue;
    }

    const note = NOTE_LINE.exec(zeile);
    if (note) {
      aktuelleSpur().notes.push({
        type: note[1] as NoteType,
        beat: basis + Number(note[2]),
        length: Number(note[3]),
        pitch: Number(note[4]),
        syllable: note[5] ?? "",
      });
      continue;
    }

    const umbruch = BREAK_LINE.exec(getrimmt);
    if (umbruch) {
      const spur = aktuelleSpur();
      const vorige = spur.notes[spur.notes.length - 1];
      const erste = Number(umbruch[1]);
      const zweite = umbruch[2] === undefined ? undefined : Number(umbruch[2]);
      const mark: LineBreakMark = { beat: basis + erste };
      // In RELATIVE files the second number moves the line start; in
      // absolute files it is the end of the pause.
      if (relativ) basis += zweite ?? erste;
      else if (zweite !== undefined) mark.end = zweite;
      // A break before the first note of a track means nothing to any game.
      if (vorige) spur.notes[spur.notes.length - 1] = { ...vorige, breakAfter: mark };
      continue;
    }

    throw new SongTxtError("badLine", nr);
  }

  if (!tracks.some((t) => t.notes.length > 0)) throw new SongTxtError("noNotes");
  const letzte = tracks.length - 1;
  const ergebnis: SongTxt = {
    headers,
    tracks: tracks.map((t, i) => (i === letzte ? ohneSchlussUmbruch(t) : t)),
    eol,
  };
  if (trailer.length > 0) ergebnis.trailer = trailer;
  if (relativ) ergebnis.relative = true;
  return ergebnis;
};

const ganzzahl = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v);

const ohneZeilenumbruch = (v: unknown): boolean =>
  typeof v === "string" && !/[\r\n]/.test(v);

const noteOk = (n: EditNote): boolean => {
  const umbruchOk =
    n?.breakAfter === undefined ||
    (ganzzahl(n.breakAfter?.beat) &&
      (n.breakAfter.end === undefined || ganzzahl(n.breakAfter.end)));
  return (
    umbruchOk &&
    NOTE_TYPES.includes(n.type) &&
    ganzzahl(n.beat) &&
    ganzzahl(n.length) &&
    // 0 occurs in real files; refusing it would make them unsaveable.
    n.length >= 0 &&
    ganzzahl(n.pitch) &&
    ohneZeilenumbruch(n.syllable) &&
    (n.unsure === undefined || UNSURE_KINDS.includes(n.unsure))
  );
};

/**
 * The model also arrives over IPC from the renderer, so the writer checks
 * what the parser guarantees: a newline in a syllable, a header or a marker
 * would tear the line structure apart.
 */
const pruefe = (song: SongTxt): void => {
  if (
    !Array.isArray(song?.headers) ||
    !Array.isArray(song.tracks) ||
    song.tracks.length === 0 ||
    (song.eol !== "\n" && song.eol !== "\r\n") ||
    (song.relative !== undefined && typeof song.relative !== "boolean")
  ) {
    throw new SongTxtError("badValue");
  }
  for (const h of song.headers) {
    const ok =
      typeof h?.key === "string" &&
      HEADER_KEY.test(h.key) &&
      h.key === h.key.trim() &&
      ohneZeilenumbruch(h.value);
    if (!ok) throw new SongTxtError("badHeader");
  }
  const trailerOk =
    song.trailer === undefined ||
    (Array.isArray(song.trailer) && song.trailer.every(ohneZeilenumbruch));
  if (!trailerOk) throw new SongTxtError("badValue");
  for (const t of song.tracks) {
    const markerOk =
      t?.marker === undefined ||
      (typeof t.marker === "string" && MARKER_LINE.test(t.marker));
    if (!markerOk || !Array.isArray(t.notes) || !t.notes.every(noteOk)) {
      throw new SongTxtError("badValue");
    }
  }
  if (!song.tracks.some((t) => t.notes.length > 0)) throw new SongTxtError("noNotes");
};

/**
 * Written as read, unless it now lies behind the start of the next note -
 * only possible after an edit, and a game would switch lines mid-word. Then
 * it is pulled back to the end of its note. Hand-placed breaks inside their
 * own note are common in USDB files and stay untouched.
 */
const umbruchBeat = (note: EditNote, naechste: EditNote | undefined): number => {
  const mark = note.breakAfter as LineBreakMark;
  if (naechste === undefined || mark.beat <= naechste.beat) return mark.beat;
  return Math.min(note.beat + note.length, naechste.beat);
};

const schreibeSpur = (
  t: Track,
  relativ: boolean,
  istLetzte: boolean,
  zeilen: string[],
  /** RELATIVE line start per singer, carried across repeated markers. */
  basen: Map<string, number>,
): void => {
  if (t.marker !== undefined) zeilen.push(t.marker);
  const schluessel = markerKey(t.marker ?? "");
  let basis = basen.get(schluessel) ?? 0;
  t.notes.forEach((n, i) => {
    zeilen.push(`${n.type} ${n.beat - basis} ${n.length} ${n.pitch} ${n.syllable}`);
    const naechste = t.notes[i + 1];
    if (!n.breakAfter || (naechste === undefined && istLetzte)) return;
    const beat = umbruchBeat(n, naechste);
    if (relativ) {
      // The next line counts from the break: "- x x".
      zeilen.push(`- ${beat - basis} ${beat - basis}`);
      basis = beat;
      return;
    }
    const ende = n.breakAfter.end;
    const endeGueltig =
      ende !== undefined && ende >= beat && (naechste === undefined || ende <= naechste.beat);
    zeilen.push(endeGueltig ? `- ${beat} ${ende}` : `- ${beat}`);
  });
  basen.set(schluessel, basis);
};

export const serializeSongTxt = (song: SongTxt): string => {
  pruefe(song);
  const zeilen = song.headers.map((h) => `#${h.key}:${h.value}`);
  const letzte = song.tracks.length - 1;
  const basen = new Map<string, number>();
  song.tracks.forEach((t, i) => {
    schreibeSpur(t, song.relative === true, i === letzte, zeilen, basen);
  });
  zeilen.push("E");
  if (song.trailer) zeilen.push(...song.trailer);
  return `${zeilen.join(song.eol)}${song.eol}`;
};

export const withTrack = (song: SongTxt, index: number, track: Track): SongTxt =>
  song.tracks[index] === track
    ? song
    : { ...song, tracks: song.tracks.map((t, i) => (i === index ? track : t)) };

export const noteCount = (song: SongTxt): number =>
  song.tracks.reduce((summe, t) => summe + t.notes.length, 0);

const gleicherKey = (a: string, b: string): boolean =>
  a.toUpperCase() === b.toUpperCase();

export const headerValue = (song: SongTxt, key: string): string | undefined =>
  song.headers.find((h) => gleicherKey(h.key, key))?.value;

/** German files write "1200,5"; both separators are read. */
export const headerNumber = (song: SongTxt, key: string): number | undefined => {
  const roh = headerValue(song, key);
  if (roh === undefined) return undefined;
  const zahl = Number(roh.trim().replace(",", "."));
  return Number.isFinite(zahl) ? zahl : undefined;
};

/** Replaces the value and keeps the file's spelling of the key. */
export const withHeader = (song: SongTxt, key: string, value: string): SongTxt => {
  const vorhanden = song.headers.some((h) => gleicherKey(h.key, key));
  const headers = vorhanden
    ? song.headers.map((h) => (gleicherKey(h.key, key) ? { key: h.key, value } : h))
    : [...song.headers, { key: key.toUpperCase(), value }];
  return { ...song, headers };
};

export const withoutHeader = (song: SongTxt, key: string): SongTxt => ({
  ...song,
  headers: song.headers.filter((h) => !gleicherKey(h.key, key)),
});

/**
 * The singer's name for a duet track: "#P1:" in format 1.x, "#DUETSINGERP1:"
 * in older files. undefined for a solo track or an unnamed one.
 */
export const trackName = (song: SongTxt, track: Track): string | undefined => {
  const nr = track.marker?.replace(/\D/g, "");
  if (!nr) return undefined;
  const name = headerValue(song, `P${nr}`) ?? headerValue(song, `DUETSINGERP${nr}`);
  return name?.trim() || undefined;
};

/** Milliseconds of one beat: UltraStar's BPM counts quarter beats. */
export const beatMs = (bpm: number): number => 60000 / (bpm * 4);

export type Timing = { bpm: number; gap: number };

export const timingOf = (song: SongTxt): Timing | null => {
  const bpm = headerNumber(song, "BPM");
  if (bpm === undefined || bpm <= 0) return null;
  return { bpm, gap: headerNumber(song, "GAP") ?? 0 };
};

export const beatToMs = (t: Timing, beat: number): number =>
  t.gap + beat * beatMs(t.bpm);

export const msToBeat = (t: Timing, ms: number): number =>
  (ms - t.gap) / beatMs(t.bpm);
