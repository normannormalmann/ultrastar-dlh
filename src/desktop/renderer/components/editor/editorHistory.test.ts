// src/desktop/renderer/components/editor/editorHistory.test.ts
import { describe, expect, it } from "bun:test";
import { type NotePatch, updateNote } from "../../../../core/edit/noteEdits.ts";
import { type Track, withTrack } from "../../../../core/edit/songTxt.ts";
import type { SongTxt } from "../../../shared/ipcContract.ts";
import { commit, isDirty, markSaved, redo, startHistory, undo } from "./editorHistory.ts";

const song: SongTxt = {
  headers: [],
  eol: "\n",
  tracks: [{ notes: [{ type: ":", beat: 0, length: 4, pitch: 5, syllable: "a" }] }],
};

/** The tests edit the only track; the model holds a list of them. */
const aendere = (s: SongTxt, i: number, patch: NotePatch): SongTxt =>
  withTrack(s, 0, updateNote(s.tracks[0] as Track, i, patch));

describe("editorHistory", () => {
  it("ist nach dem Laden sauber", () => {
    expect(isDirty(startHistory(song))).toBe(false);
  });

  it("macht rueckgaengig und wiederholt", () => {
    const a = aendere(song, 0, { pitch: 6 });
    const b = aendere(a, 0, { pitch: 7 });
    let h = commit(commit(startHistory(song), a), b);
    h = undo(h);
    expect(h.present).toBe(a);
    h = undo(h);
    expect(h.present).toBe(song);
    expect(isDirty(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present).toBe(b);
  });

  it("verwirft das Wiederholen nach einer neuen Aenderung", () => {
    const a = aendere(song, 0, { pitch: 6 });
    const h = commit(undo(commit(startHistory(song), a)), aendere(song, 0, { pitch: 1 }));
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it("legt fuer eine wirkungslose Aenderung keinen Schritt an", () => {
    const h = startHistory(song);
    expect(commit(h, song)).toBe(h);
  });

  it("ist nach dem Speichern sauber, nach Rueckgaengig wieder ungespeichert", () => {
    const a = aendere(song, 0, { pitch: 6 });
    const h = markSaved(commit(startHistory(song), a), a);
    expect(isDirty(h)).toBe(false);
    expect(isDirty(undo(h))).toBe(true);
  });

  it("begrenzt die Rueckgaengig-Liste", () => {
    let h = startHistory(song);
    for (let i = 0; i < 400; i += 1) h = commit(h, aendere(h.present, 0, { pitch: i }));
    expect(h.past.length).toBe(300);
  });
});
