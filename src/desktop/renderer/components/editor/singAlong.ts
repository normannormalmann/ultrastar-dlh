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
  /**
   * How late the take arrived relative to the notes, in ms, as measured
   * from the take itself (positive: late). Already compensated in pitches.
   */
  offsetMs: number;
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

/** The offset search: this far in both directions, in steps of this size. */
const OFFSET_RANGE_MS = 300;
const OFFSET_STEP_MS = 10;
/** A reading matches a note when its pitch class sits within this of the note's. */
const PITCH_MATCH_TOLERANCE = 0.75;
/** The best offset must beat "no offset" by this share, or it is noise. */
const OFFSET_MIN_GAIN = 1.1;

/** Smallest distance between two pitch classes, octaves ignored. */
const pitchClassDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
};

/**
 * Measures the take's latency from the take itself: the shift of the sung
 * line, in ms, that makes the most readings sit inside a note of the same
 * pitch class. Device estimates (microphone buffer, output latency) are
 * rough, and the singer's own reaction time is not in them at all; both
 * are constant over one take and show up as one offset. Octaves are
 * ignored on purpose - the register is settled later, per take.
 *
 * Returns 0 when nothing fits (silence, a different melody) or when the
 * best shift is not clearly better than none: a short stretch of a few
 * notes gives the search little to hold on to, and a wrong shift would
 * be worse than the raw device estimate.
 */
export const estimateOffsetMs = (
  seq: NoteSeq,
  from: number,
  to: number,
  timing: Timing,
  frames: SungFrame[],
): number => {
  const noten: { von: number; bis: number; pitch: number }[] = [];
  for (let i = Math.max(0, from); i <= Math.min(to, seq.notes.length - 1); i += 1) {
    const n = seq.notes[i] as EditNote;
    if (n.type === "F" || n.length <= 0) continue;
    noten.push({ von: beatToMs(timing, n.beat), bis: beatToMs(timing, n.beat + n.length), pitch: n.pitch });
  }
  if (noten.length === 0 || frames.length < MIN_FRAMES) return 0;

  const treffer = (offset: number): number => {
    let zahl = 0;
    for (const f of frames) {
      const ms = f.ms - offset;
      const note = noten.find((n) => ms >= n.von && ms < n.bis);
      if (note && pitchClassDistance(f.midi - MIDI_OFFSET, note.pitch) <= PITCH_MATCH_TOLERANCE) zahl += 1;
    }
    return zahl;
  };

  const ohne = treffer(0);
  let bester = 0;
  let besteZahl = ohne;
  for (let offset = -OFFSET_RANGE_MS; offset <= OFFSET_RANGE_MS; offset += OFFSET_STEP_MS) {
    const zahl = treffer(offset);
    // Strictly better, or equally good but closer to zero.
    if (zahl > besteZahl || (zahl === besteZahl && Math.abs(offset) < Math.abs(bester))) {
      bester = offset;
      besteZahl = zahl;
    }
  }
  if (besteZahl < MIN_FRAMES || besteZahl < ohne * OFFSET_MIN_GAIN) return 0;
  return bester;
};

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
  // The take's own latency first: readings are moved back by it, so each
  // note is judged by what was sung for it, not for its neighbour.
  const offsetMs = estimateOffsetMs(seq, from, to, timing, frames);
  const ausgerichtet = offsetMs === 0 ? frames : frames.map((f) => ({ ms: f.ms - offsetMs, midi: f.midi }));
  const gesungen = new Map<number, number>();
  for (let i = Math.max(0, from); i <= Math.min(to, seq.notes.length - 1); i += 1) {
    const n = seq.notes[i] as EditNote;
    if (n.type === "F" || n.length <= 0) continue;
    const midi = gesungenFuer(n, timing, ausgerichtet);
    if (midi !== null) gesungen.set(i, midi - MIDI_OFFSET);
  }
  if (gesungen.size === 0) return { pitches: new Map(), octaveShift: 0, judged: 0, offsetMs };

  const abstaende = [...gesungen].map(([i, p]) => p - (seq.notes[i] as EditNote).pitch);
  const octaveShift = Math.round(median(abstaende) / 12);

  const pitches = new Map<number, number>();
  for (const [i, p] of gesungen) {
    const ziel = Math.round(p - octaveShift * 12);
    if (ziel !== (seq.notes[i] as EditNote).pitch) pitches.set(i, ziel);
  }
  return { pitches, octaveShift, judged: gesungen.size, offsetMs };
};
