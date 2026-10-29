// src/desktop/renderer/components/editor/singAlong.ts
// From a sung take to pitch suggestions for the notes of a stretch. Pure,
// so the judgement calls below are testable without a microphone.
import { beatToMs, type EditNote, type NoteSeq, type Timing } from "../../../../core/edit/songTxt.ts";

/** One microphone reading: when (song time) and which MIDI note, as a float. */
export type SungFrame = { ms: number; midi: number };

export type SingSuggestion = {
  /** Note index -> suggested UltraStar pitch; only notes that change. */
  pitches: Map<number, number>;
  /** Octaves the take was moved by to land in the song's register. */
  octaveShift: number;
  /** Notes in the stretch that were sung clearly enough to judge. */
  judged: number;
};

/** UltraStar pitch 0 is C4, MIDI 60. */
const MIDI_OFFSET = 60;
/**
 * The start of a note is skipped: the voice slides into a tone, and the
 * latency estimate is rough. The steady middle and end decide.
 */
const ONSET_SKIP = 0.25;
/** At least this share of a note's (trimmed) time must carry a tone. */
const MIN_VOICED_SHARE = 0.4;
const MIN_FRAMES = 3;

const median = (werte: number[]): number => {
  const s = [...werte].sort((a, b) => a - b);
  const mitte = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mitte] as number) : ((s[mitte - 1] as number) + (s[mitte] as number)) / 2;
};

/** Frames per second the sampling loop delivers - used to judge coverage. */
export const FRAME_RATE_HINT = 60;

const gesungenFuer = (
  n: EditNote,
  timing: Timing,
  frames: SungFrame[],
): number | null => {
  const start = beatToMs(timing, n.beat);
  const ende = beatToMs(timing, n.beat + n.length);
  const von = start + (ende - start) * ONSET_SKIP;
  const treffer = frames.filter((f) => f.ms >= von && f.ms < ende).map((f) => f.midi);
  const erwartet = ((ende - von) / 1000) * FRAME_RATE_HINT;
  if (treffer.length < MIN_FRAMES || treffer.length < erwartet * MIN_VOICED_SHARE) return null;
  return median(treffer);
};

/**
 * Suggests a pitch for every note in [from, to] that was clearly sung.
 * Freestyle notes have no pitch to correct and are left out.
 *
 * Octave: people sing a song in their own register - a man an octave below
 * a female singer. One shift for the whole take, the one that brings the
 * sung line closest to the existing notes, keeps the melody and moves it
 * into the song's range. Per-note octave guessing would turn every small
 * detection slip into a jump of twelve.
 */
export const suggestPitches = (
  seq: NoteSeq,
  from: number,
  to: number,
  timing: Timing,
  frames: SungFrame[],
): SingSuggestion => {
  const gesungen = new Map<number, number>();
  for (let i = Math.max(0, from); i <= Math.min(to, seq.notes.length - 1); i += 1) {
    const n = seq.notes[i] as EditNote;
    if (n.type === "F" || n.length <= 0) continue;
    const midi = gesungenFuer(n, timing, frames);
    if (midi !== null) gesungen.set(i, midi - MIDI_OFFSET);
  }
  if (gesungen.size === 0) return { pitches: new Map(), octaveShift: 0, judged: 0 };

  const abstaende = [...gesungen].map(([i, p]) => p - (seq.notes[i] as EditNote).pitch);
  const octaveShift = Math.round(median(abstaende) / 12);

  const pitches = new Map<number, number>();
  for (const [i, p] of gesungen) {
    const ziel = Math.round(p - octaveShift * 12);
    if (ziel !== (seq.notes[i] as EditNote).pitch) pitches.set(i, ziel);
  }
  return { pitches, octaveShift, judged: gesungen.size };
};
