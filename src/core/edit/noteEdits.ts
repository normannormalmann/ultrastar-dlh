// src/core/edit/noteEdits.ts
// The editor's operations, as pure functions over one track's notes. Each
// returns a new object and leaves the old one untouched, so undo is a list
// of snapshots. An operation that does not apply returns its input as is -
// the same object, so no empty undo step appears.
import type { EditNote, NoteSeq, NoteType } from "./songTxt.ts";

export type NotePatch = Partial<
  Pick<EditNote, "type" | "beat" | "length" | "pitch" | "syllable">
>;

const ersetzeNoten = <T extends NoteSeq>(seq: T, notes: EditNote[]): T => ({
  ...seq,
  notes,
});

const gibt = (seq: NoteSeq, i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < seq.notes.length;

/** No newline in a syllable: the writer would refuse the whole song. */
const silbe = (s: string): string => s.replace(/[\r\n]+/g, " ");

/**
 * A note stays between its neighbours. Every line and lookup assumes the
 * notes are in beat order; a note dragged past the next one would make the
 * line structure nonsense. Overlapping is allowed (and shown), overtaking
 * is not.
 */
const klemmeBeat = (notes: EditNote[], i: number, beat: number): number => {
  const vor = notes[i - 1];
  const nach = notes[i + 1];
  let b = beat;
  if (vor) b = Math.max(b, vor.beat);
  if (nach) b = Math.min(b, nach.beat);
  return b;
};

const gleicheNote = (a: EditNote, b: EditNote): boolean =>
  a.type === b.type &&
  a.beat === b.beat &&
  a.length === b.length &&
  a.pitch === b.pitch &&
  a.syllable === b.syllable;

const verschiebeUmbruch = (n: EditNote, delta: number): EditNote =>
  n.breakAfter && delta !== 0
    ? {
        ...n,
        breakAfter: {
          beat: n.breakAfter.beat + delta,
          ...(n.breakAfter.end !== undefined ? { end: n.breakAfter.end + delta } : {}),
        },
      }
    : n;

export const updateNote = <T extends NoteSeq>(seq: T, i: number, patch: NotePatch): T => {
  if (!gibt(seq, i)) return seq;
  const alt = seq.notes[i] as EditNote;
  const beat = klemmeBeat(seq.notes, i, Math.round(patch.beat ?? alt.beat));
  const neu: EditNote = verschiebeUmbruch(
    {
      ...alt,
      ...patch,
      beat,
      length: Math.max(1, Math.round(patch.length ?? alt.length)),
      pitch: Math.round(patch.pitch ?? alt.pitch),
      syllable: silbe(patch.syllable ?? alt.syllable),
    },
    beat - alt.beat,
  );
  if (gleicheNote(alt, neu)) return seq;
  return ersetzeNoten(
    seq,
    seq.notes.map((n, j) => (j === i ? neu : n)),
  );
};

/**
 * Moves note i and everything after it. This is the sync fix: when the
 * recognition drifts, from some point on the whole rest is late or early by
 * the same amount.
 */
export const shiftFrom = <T extends NoteSeq>(seq: T, i: number, delta: number): T => {
  if (!gibt(seq, i)) return seq;
  // Only the left edge can collide: everything after moves along.
  const start = (seq.notes[i] as EditNote).beat;
  const d = klemmeBeat(seq.notes.slice(0, i + 1), i, start + Math.round(delta)) - start;
  if (d === 0) return seq;
  return ersetzeNoten(
    seq,
    seq.notes.map((n, j) => (j >= i ? verschiebeUmbruch({ ...n, beat: n.beat + d }, d) : n)),
  );
};

/** Moves a single note between its neighbours; its line break travels with it. */
export const moveNote = <T extends NoteSeq>(seq: T, i: number, delta: number): T => {
  if (!gibt(seq, i)) return seq;
  return updateNote(seq, i, { beat: (seq.notes[i] as EditNote).beat + delta });
};

/**
 * The last note of a track can not be deleted: the writer refuses a song
 * without notes. A line break on the deleted note moves to the one before,
 * so the line structure survives.
 */
export const deleteNote = <T extends NoteSeq>(seq: T, i: number): T => {
  if (!gibt(seq, i) || seq.notes.length <= 1) return seq;
  const weg = seq.notes[i] as EditNote;
  const notes = seq.notes.filter((_, j) => j !== i);
  const vorher = notes[i - 1];
  if (weg.breakAfter && vorher && !vorher.breakAfter && i < notes.length) {
    notes[i - 1] = { ...vorher, breakAfter: weg.breakAfter };
  }
  return ersetzeNoten(seq, notes);
};

/**
 * Halves a note. The second half sings on with "~", the UltraStar mark for
 * "same syllable, held on" - that keeps the lyric line intact.
 */
export const splitNote = <T extends NoteSeq>(seq: T, i: number): T => {
  if (!gibt(seq, i)) return seq;
  const n = seq.notes[i] as EditNote;
  if (n.length < 2) return seq;
  const links = Math.floor(n.length / 2);
  const { breakAfter, ...ohneUmbruch } = n;
  const erste: EditNote = { ...ohneUmbruch, length: links };
  const zweite: EditNote = {
    ...ohneUmbruch,
    beat: n.beat + links,
    length: n.length - links,
    syllable: "~",
    ...(breakAfter ? { breakAfter } : {}),
  };
  const notes = [...seq.notes];
  notes.splice(i, 1, erste, zweite);
  return ersetzeNoten(seq, notes);
};

/**
 * Joins note i with the one after it into one note spanning both. A "~"
 * on the second only said "held on" and disappears; real text is appended.
 * A doubt on either half stays on the whole.
 */
export const mergeWithNext = <T extends NoteSeq>(seq: T, i: number): T => {
  if (!gibt(seq, i) || !gibt(seq, i + 1)) return seq;
  const a = seq.notes[i] as EditNote;
  const b = seq.notes[i + 1] as EditNote;
  const zusatz = b.syllable.replace(/^~/, "");
  const { breakAfter: _, unsure: __, ...ohneUmbruch } = a;
  const zweifel = a.unsure ?? b.unsure;
  const neu: EditNote = {
    ...ohneUmbruch,
    length: Math.max(1, b.beat + b.length - a.beat),
    syllable: a.syllable + zusatz,
    ...(b.breakAfter ? { breakAfter: b.breakAfter } : {}),
    ...(zweifel ? { unsure: zweifel } : {}),
  };
  const notes = [...seq.notes];
  notes.splice(i, 2, neu);
  return ersetzeNoten(seq, notes);
};

/** Adds or removes the line break after note i (never after the last). */
export const toggleBreakAfter = <T extends NoteSeq>(seq: T, i: number): T => {
  if (!gibt(seq, i) || i === seq.notes.length - 1) return seq;
  const n = seq.notes[i] as EditNote;
  const naechste = seq.notes[i + 1] as EditNote;
  let neu: EditNote;
  if (n.breakAfter) {
    const { breakAfter: _, ...rest } = n;
    neu = rest;
  } else {
    neu = { ...n, breakAfter: { beat: Math.min(n.beat + n.length, naechste.beat) } };
  }
  return ersetzeNoten(
    seq,
    seq.notes.map((x, j) => (j === i ? neu : x)),
  );
};

/** Golden and freestyle toggle against normal; a second press undoes it. */
export const toggleType = <T extends NoteSeq>(seq: T, i: number, type: NoteType): T => {
  if (!gibt(seq, i)) return seq;
  const n = seq.notes[i] as EditNote;
  return updateNote(seq, i, { type: n.type === type ? ":" : type });
};

/** Several pitches at once - one undo step for a whole sung line. */
export const setPitches = <T extends NoteSeq>(seq: T, pitches: ReadonlyMap<number, number>): T => {
  let geaendert = false;
  const notes = seq.notes.map((n, i) => {
    const neu = pitches.get(i);
    if (neu === undefined || !Number.isInteger(neu) || neu === n.pitch) return n;
    geaendert = true;
    return { ...n, pitch: neu };
  });
  return geaendert ? ersetzeNoten(seq, notes) : seq;
};

/**
 * Indices of notes that start before the previous one ends. Games cope with
 * a few, but they are almost always a slip of the mouse.
 */
export const overlaps = (seq: NoteSeq): Set<number> => {
  const ergebnis = new Set<number>();
  for (let i = 1; i < seq.notes.length; i += 1) {
    const vor = seq.notes[i - 1] as EditNote;
    const n = seq.notes[i] as EditNote;
    if (n.beat < vor.beat + vor.length) ergebnis.add(i);
  }
  return ergebnis;
};

/** The note under a beat, or the nearest one before it. */
export const noteAtBeat = (seq: NoteSeq, beat: number): number => {
  let treffer = -1;
  for (let i = 0; i < seq.notes.length; i += 1) {
    if ((seq.notes[i] as EditNote).beat <= beat) treffer = i;
    else break;
  }
  return treffer;
};

/** The lyric line note i belongs to, as [first, last] indices. */
export const lineOf = (seq: NoteSeq, i: number): [number, number] => {
  if (!gibt(seq, i)) return [0, -1];
  let von = i;
  while (von > 0 && !(seq.notes[von - 1] as EditNote).breakAfter) von -= 1;
  let bis = i;
  while (bis < seq.notes.length - 1 && !(seq.notes[bis] as EditNote).breakAfter) {
    bis += 1;
  }
  return [von, bis];
};

/**
 * The run of doubted notes around i, as [first, last]; null if i is not
 * doubted. A run is one kind of doubt: guessed timing next to a weak
 * measurement is two stretches, as in sync-hints.json and the drawing.
 */
export const unsureRun = (seq: NoteSeq, i: number): [number, number] | null => {
  const art = gibt(seq, i) ? seq.notes[i]?.unsure : undefined;
  if (!art) return null;
  let von = i;
  while (von > 0 && seq.notes[von - 1]?.unsure === art) von -= 1;
  let bis = i;
  while (bis < seq.notes.length - 1 && seq.notes[bis + 1]?.unsure === art) bis += 1;
  return [von, bis];
};

/** Note j opens a run: doubted, and not the same doubt as the note before. */
const laufBeginn = (seq: NoteSeq, j: number): boolean => {
  const art = seq.notes[j]?.unsure;
  return art !== undefined && (j === 0 || seq.notes[j - 1]?.unsure !== art);
};

/** "Checked": the user looked at this stretch, the doubt goes away. */
export const markChecked = <T extends NoteSeq>(seq: T, i: number): T => {
  const lauf = unsureRun(seq, i);
  if (!lauf) return seq;
  const [von, bis] = lauf;
  return ersetzeNoten(
    seq,
    seq.notes.map((n, j) => {
      if (j < von || j > bis) return n;
      const { unsure: _, ...rest } = n;
      return rest;
    }),
  );
};

/**
 * First note of the next doubted run after the one i is in, wrapping around
 * at the end. -1 when nothing is doubted any more.
 */
export const nextUnsure = (seq: NoteSeq, i: number | null): number => {
  const n = seq.notes.length;
  const start = i === null ? 0 : (unsureRun(seq, i)?.[1] ?? i) + 1;
  for (let k = 0; k < n; k += 1) {
    const j = (start + k) % n;
    if (laufBeginn(seq, j)) return j;
  }
  return -1;
};

/** How many separate doubted stretches remain. */
export const unsureRunCount = (seq: NoteSeq): number =>
  seq.notes.filter((_, i) => laufBeginn(seq, i)).length;
