// src/desktop/renderer/components/editor/editorHistory.ts
// Undo as a list of snapshots. Cheap because every edit in noteEdits.ts
// returns a new song and shares the untouched notes with the old one.
import type { SongTxt } from "../../../shared/ipcContract.ts";

/** Generous for one session; a song has a few hundred notes at most. */
const MAX_UNDO = 300;

export type History = {
  past: SongTxt[];
  present: SongTxt;
  future: SongTxt[];
  /** The version on disk - "unsaved" means present is not this one. */
  saved: SongTxt;
};

export const startHistory = (song: SongTxt): History => ({
  past: [],
  present: song,
  future: [],
  saved: song,
});

/** An edit that changed nothing (same object back) adds no undo step. */
export const commit = (h: History, next: SongTxt): History =>
  next === h.present
    ? h
    : {
        ...h,
        past: [...h.past, h.present].slice(-MAX_UNDO),
        present: next,
        future: [],
      };

export const undo = (h: History): History => {
  const vorher = h.past[h.past.length - 1];
  if (!vorher) return h;
  return {
    ...h,
    past: h.past.slice(0, -1),
    present: vorher,
    future: [h.present, ...h.future],
  };
};

export const redo = (h: History): History => {
  const [naechste, ...rest] = h.future;
  if (!naechste) return h;
  return { ...h, past: [...h.past, h.present], present: naechste, future: rest };
};

/** After a save: the given version is now what is on disk. */
export const markSaved = (h: History, song: SongTxt): History => ({
  ...h,
  saved: song,
});

export const isDirty = (h: History): boolean => h.present !== h.saved;
