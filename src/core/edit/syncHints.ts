// src/core/edit/syncHints.ts
// Where the creation pipeline doubted itself, kept next to song.txt so the
// correction editor can point there. song_data.json, which knows all this,
// is deleted with the job folder; this small file is what survives.
//
// Stored as beat ranges, not note indices: indices mean nothing once a note
// is split or deleted, and the file must still make sense to a reader who
// edited song.txt by hand in between.
import type { SongData } from "../create/songData.ts";
import { type EditNote, type NoteSeq, UNSURE_KINDS, type UnsureKind } from "./songTxt.ts";

export const SYNC_HINTS_FILE = "sync-hints.json";
const VERSION = 1;

/**
 * Same threshold as UNSICHER_AB in python-sidecar/ultrastar_pipeline/
 * contract.py, which counts the unsureRatio - the editor marks what the
 * pipeline itself calls unsure.
 */
export const UNSURE_BELOW = 0.6;

export type SyncHint = {
  fromBeat: number;
  /** Exclusive. */
  toBeat: number;
  kind: UnsureKind;
};

export type SyncHintsFile = { version: number; hints: SyncHint[] };

const ende = (n: { beat: number; length: number }): number =>
  Math.round(n.beat) + Math.round(n.length);

/** Consecutive marked notes become one range. */
const zuBereichen = <N extends { beat: number; length: number }>(
  notes: readonly N[],
  artVon: (n: N, i: number) => UnsureKind | undefined,
): SyncHint[] => {
  const hints: SyncHint[] = [];
  notes.forEach((n, i) => {
    const kind = artVon(n, i);
    if (!kind) return;
    const letzter = hints[hints.length - 1];
    const vorher = notes[i - 1];
    if (letzter && vorher && artVon(vorher, i - 1) === kind) {
      letzter.toBeat = Math.max(letzter.toBeat, ende(n));
      return;
    }
    // At least one beat wide: a note of length 0 (or one that rounds to 0)
    // would give an empty range, which parseSyncHints rightly drops.
    const von = Math.round(n.beat);
    hints.push({ fromBeat: von, toBeat: Math.max(von + 1, ende(n)), kind });
  });
  return hints;
};

/**
 * Interpolated sections (confidence 0: timing guessed) outrank a weak
 * measurement - the stronger doubt is the one worth naming. Beats are
 * rounded the way writeSongTxt.ts rounds them, so the ranges hit the notes
 * as they end up in song.txt.
 */
export const buildSyncHints = (data: SongData): SyncHint[] => {
  const interpoliert = new Set<number>();
  for (const s of data.sections) {
    if (s.confidence > 0) continue;
    for (let i = s.fromNoteIndex; i < s.toNoteIndex; i += 1) interpoliert.add(i);
  }
  return zuBereichen(data.notes, (n, i) => {
    if (interpoliert.has(i)) return "interpolated";
    return n.confidence !== undefined && n.confidence < UNSURE_BELOW ? "low" : undefined;
  });
};

export const serializeSyncHints = (hints: SyncHint[]): string =>
  `${JSON.stringify({ version: VERSION, hints } satisfies SyncHintsFile, null, 2)}\n`;

/**
 * Lenient on purpose: a damaged or foreign file costs the markers, never the
 * song. Unknown versions and malformed entries are dropped.
 */
export const parseSyncHints = (input: unknown): SyncHint[] => {
  if (typeof input !== "object" || input === null) return [];
  const datei = input as Partial<SyncHintsFile>;
  if (datei.version !== VERSION || !Array.isArray(datei.hints)) return [];
  return datei.hints.filter(
    (h): h is SyncHint =>
      typeof h === "object" &&
      h !== null &&
      Number.isInteger(h.fromBeat) &&
      Number.isInteger(h.toBeat) &&
      h.toBeat > h.fromBeat &&
      UNSURE_KINDS.includes(h.kind),
  );
};

/** Marks every note that starts inside a range. */
export const applySyncHints = <T extends NoteSeq>(seq: T, hints: SyncHint[]): T => {
  if (hints.length === 0) return seq;
  return {
    ...seq,
    notes: seq.notes.map((n): EditNote => {
      const h = hints.find((x) => n.beat >= x.fromBeat && n.beat < x.toBeat);
      return h ? { ...n, unsure: h.kind } : n;
    }),
  };
};

/** The ranges as they stand after editing - written back on save. */
export const collectSyncHints = (seq: NoteSeq): SyncHint[] =>
  zuBereichen(seq.notes, (n) => n.unsure);
