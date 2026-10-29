// src/desktop/renderer/components/editor/useEditorKeys.ts
// Keyboard control for the editor. Kept out of EditorView so the view is
// layout and the key map is one readable table. No Alt combinations: with
// the hidden menu bar, Alt alone toggles it.
import { useEffect, useRef } from "react";
import {
  deleteNote,
  lineOf,
  mergeWithNext,
  moveNote,
  type NotePatch,
  shiftFrom,
  splitNote,
  toggleBreakAfter,
  toggleType,
  updateNote,
} from "../../../../core/edit/noteEdits.ts";
import { beatToMs, type EditNote, type Timing, type Track } from "../../../../core/edit/songTxt.ts";
import type { Playback } from "./usePlayback.ts";

/** Lead-in and tail around "play this line", so the first word is not clipped. */
const LINE_PADDING_MS = 400;
const ZOOM_STEP = 1.25;

export type EditorKeyDeps = {
  track: Track;
  selected: number | null;
  timing: Timing | null;
  playback: Playback;
  setSelected: (i: number | null) => void;
  anwenden: (track: Track) => void;
  undo: () => void;
  redo: () => void;
  speichern: () => void;
  zoom: (faktor: number) => void;
  silbeBearbeiten: () => void;
  naechsteUnsicher: () => void;
  geprueft: () => void;
  einsingen: () => void;
  /** Only called with more than one track; Tab stays focus navigation otherwise. */
  spurWechseln: () => void;
  spurAnzahl: number;
  /** A sung take is waiting: Enter applies it, Escape drops it. */
  vorschlagOffen: boolean;
  vorschlagAnnehmen: () => void;
  vorschlagVerwerfen: () => void;
};

export type EditorActions = {
  undo: () => void;
  redo: () => void;
  playLine: () => void;
  patch: (index: number, patch: NotePatch) => void;
};

const inEingabefeld = (ziel: EventTarget | null): boolean =>
  ziel instanceof HTMLInputElement ||
  ziel instanceof HTMLTextAreaElement ||
  ziel instanceof HTMLSelectElement;

type MitNote = (f: (index: number) => Track) => void;

/** Arrow keys: select, move, resize, shift the rest, pitch. */
const pfeil = (e: KeyboardEvent, k: EditorKeyDeps, mitNote: MitNote): boolean => {
  const strg = e.ctrlKey || e.metaKey;
  const i = k.selected;
  const n = i === null ? undefined : k.track.notes[i];
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const r = e.key === "ArrowRight" ? 1 : -1;
    if (strg && e.shiftKey) mitNote((x) => shiftFrom(k.track, x, r));
    else if (strg) mitNote((x) => updateNote(k.track, x, { length: (n?.length ?? 1) + r }));
    else if (e.shiftKey) mitNote((x) => moveNote(k.track, x, r));
    else {
      const letzte = k.track.notes.length - 1;
      k.setSelected(i === null ? 0 : Math.min(letzte, Math.max(0, i + r)));
    }
    return true;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const schritt = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1);
    mitNote((x) => updateNote(k.track, x, { pitch: (n?.pitch ?? 0) + schritt }));
    return true;
  }
  return false;
};

/** Ctrl combinations. */
const mitStrg = (taste: string, shift: boolean, k: EditorKeyDeps): boolean => {
  if (taste === "z") {
    // Ctrl+Shift+Z is the other common redo.
    if (shift) k.redo();
    else k.undo();
    return true;
  }
  if (taste === "y") {
    k.redo();
    return true;
  }
  return false;
};

/** Single keys without modifiers. */
const einfach = (taste: string, k: EditorKeyDeps, mitNote: MitNote, playLine: () => void): boolean => {
  const aktionen: Record<string, () => void> = {
    " ": () => k.playback.toggle(),
    delete: () => mitNote((x) => deleteNote(k.track, x)),
    "+": () => k.zoom(ZOOM_STEP),
    "-": () => k.zoom(1 / ZOOM_STEP),
    p: playLine,
    t: () => k.playback.setTones(!k.playback.tones),
    e: k.silbeBearbeiten,
    s: () => mitNote((x) => splitNote(k.track, x)),
    m: () => mitNote((x) => mergeWithNext(k.track, x)),
    l: () => mitNote((x) => toggleBreakAfter(k.track, x)),
    g: () => mitNote((x) => toggleType(k.track, x, "*")),
    f: () => mitNote((x) => toggleType(k.track, x, "F")),
    r: () => mitNote((x) => toggleType(k.track, x, "R")),
    u: k.naechsteUnsicher,
    k: k.geprueft,
    i: k.einsingen,
  };
  const aktion = aktionen[taste];
  if (!aktion) return false;
  aktion();
  return true;
};

export const useEditorKeys = (d: EditorKeyDeps): EditorActions => {
  const depsRef = useRef(d);
  depsRef.current = d;

  const playLine = () => {
    const { track, selected, timing, playback } = depsRef.current;
    if (selected === null || !timing) return;
    const [von, bis] = lineOf(track, selected);
    const erste = track.notes[von] as EditNote;
    const letzte = track.notes[bis] as EditNote;
    playback.playRange(
      beatToMs(timing, erste.beat) - LINE_PADDING_MS,
      beatToMs(timing, letzte.beat + letzte.length) + LINE_PADDING_MS,
    );
  };

  // Subscribed once; everything current, playLine included, comes through depsRef.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = depsRef.current;
      const strg = e.ctrlKey || e.metaKey;
      const taste = e.key.toLowerCase();

      // Save works everywhere, also from inside a field.
      if (strg && taste === "s") {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        // The blur commits a half-typed field, but only on the next render.
        // Saving from this closure would write the version without it, so
        // wait a tick and take the then-current save function.
        setTimeout(() => depsRef.current.speichern(), 0);
        return;
      }
      if (inEingabefeld(e.target)) return;
      // On a focused button these keys belong to the button (and Tab to
      // focus navigation): "Discard" must not apply the suggestion.
      const aufKnopf = e.target instanceof HTMLButtonElement;
      if (aufKnopf && (taste === "enter" || taste === " " || taste === "tab")) return;

      if (taste === "tab") {
        if (k.spurAnzahl < 2 || e.shiftKey || strg) return;
        e.preventDefault();
        k.spurWechseln();
        return;
      }

      if (k.vorschlagOffen && (taste === "enter" || taste === "escape")) {
        e.preventDefault();
        if (taste === "enter") k.vorschlagAnnehmen();
        else k.vorschlagVerwerfen();
        return;
      }

      const mitNote: MitNote = (f) => {
        if (k.selected === null || !k.track.notes[k.selected]) return;
        k.anwenden(f(k.selected));
      };

      let behandelt: boolean;
      if (taste === "escape") {
        k.setSelected(null);
        behandelt = true;
      } else if (taste.startsWith("arrow")) {
        behandelt = pfeil(e, k, mitNote);
      } else if (strg) {
        behandelt = mitStrg(taste, e.shiftKey, k);
      } else {
        // Shift only matters for "+" on layouts that need it.
        behandelt = (!e.shiftKey || taste === "+") && einfach(taste, k, mitNote, playLine);
      }
      if (behandelt) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    undo: () => depsRef.current.undo(),
    redo: () => depsRef.current.redo(),
    playLine,
    patch: (index, patch) => {
      const k = depsRef.current;
      k.anwenden(updateNote(k.track, index, patch));
    },
  };
};
