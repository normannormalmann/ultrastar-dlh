// src/core/edit/noteEdits.test.ts
import { describe, expect, it } from "bun:test";
import {
  deleteNote,
  lineOf,
  markChecked,
  mergeWithNext,
  moveNote,
  nextUnsure,
  noteAtBeat,
  overlaps,
  setPitches,
  shiftFrom,
  splitNote,
  toggleBreakAfter,
  toggleType,
  unsureRun,
  unsureRunCount,
  updateNote,
} from "./noteEdits.ts";
import type { Track } from "./songTxt.ts";

const song: Track = {
  notes: [
    { type: ":", beat: 0, length: 4, pitch: 5, syllable: "Hal" },
    { type: ":", beat: 4, length: 4, pitch: 7, syllable: "lo", breakAfter: { beat: 10 } },
    { type: ":", beat: 12, length: 6, pitch: 9, syllable: " Welt" },
    { type: ":", beat: 20, length: 2, pitch: 9, syllable: "~" },
  ],
};

describe("noteEdits", () => {
  it("aendert das Original nie", () => {
    const kopie = structuredClone(song);
    updateNote(song, 0, { pitch: 1 });
    shiftFrom(song, 1, 3);
    deleteNote(song, 1);
    splitNote(song, 2);
    mergeWithNext(song, 0);
    toggleBreakAfter(song, 0);
    expect(song).toEqual(kopie);
  });

  it("rundet und haelt die Laenge bei mindestens 1", () => {
    const neu = updateNote(song, 0, { beat: 1.4, length: 0, pitch: 6.6 });
    expect(neu.notes[0]).toMatchObject({ beat: 1, length: 1, pitch: 7 });
  });

  it("entfernt Zeilenumbrueche aus Silben", () => {
    expect(updateNote(song, 0, { syllable: "a\nb" }).notes[0]?.syllable).toBe("a b");
  });

  it("verschiebt ab einer Note alles Folgende samt Umbruch", () => {
    const neu = shiftFrom(song, 1, 2);
    expect(neu.notes.map((n) => n.beat)).toEqual([0, 6, 14, 22]);
    expect(neu.notes[1]?.breakAfter).toEqual({ beat: 12 });
  });

  it("verschiebt eine einzelne Note", () => {
    expect(moveNote(song, 2, -1).notes.map((n) => n.beat)).toEqual([0, 4, 11, 20]);
  });

  it("gibt den Umbruch einer geloeschten Note an die vorige weiter", () => {
    const neu = deleteNote(song, 1);
    expect(neu.notes).toHaveLength(3);
    expect(neu.notes[0]?.breakAfter).toEqual({ beat: 10 });
  });

  it("loescht die letzte verbliebene Note nicht", () => {
    const eine: Track = { notes: [song.notes[0]!] };
    expect(deleteNote(eine, 0)).toBe(eine);
  });

  it("teilt eine Note in zwei, die zweite haelt mit ~", () => {
    const neu = splitNote(song, 1);
    expect(neu.notes).toHaveLength(5);
    expect(neu.notes[1]).toEqual({ type: ":", beat: 4, length: 2, pitch: 7, syllable: "lo" });
    expect(neu.notes[2]).toEqual({
      type: ":",
      beat: 6,
      length: 2,
      pitch: 7,
      syllable: "~",
      breakAfter: { beat: 10 },
    });
  });

  it("teilt eine Note der Laenge 1 nicht", () => {
    const kurz = updateNote(song, 0, { length: 1 });
    expect(splitNote(kurz, 0)).toBe(kurz);
  });

  it("verbindet zwei Noten und schluckt das ~", () => {
    const neu = mergeWithNext(song, 2);
    expect(neu.notes).toHaveLength(3);
    expect(neu.notes[2]).toEqual({ type: ":", beat: 12, length: 10, pitch: 9, syllable: " Welt" });
  });

  it("uebernimmt beim Verbinden den Umbruch der zweiten Note", () => {
    const neu = mergeWithNext(song, 0);
    expect(neu.notes[0]).toMatchObject({ syllable: "Hallo", length: 8, breakAfter: { beat: 10 } });
  });

  it("schaltet Umbrueche, aber nie nach der letzten Note", () => {
    expect(toggleBreakAfter(song, 1).notes[1]?.breakAfter).toBeUndefined();
    expect(toggleBreakAfter(song, 0).notes[0]?.breakAfter).toEqual({ beat: 4 });
    expect(toggleBreakAfter(song, 3)).toBe(song);
  });

  it("schaltet goldene Noten an und wieder aus", () => {
    const gold = toggleType(song, 0, "*");
    expect(gold.notes[0]?.type).toBe("*");
    expect(toggleType(gold, 0, "*").notes[0]?.type).toBe(":");
  });

  it("findet Ueberlappungen", () => {
    expect(overlaps(song).size).toBe(0);
    expect([...overlaps(moveNote(song, 1, -2))]).toEqual([1]);
  });

  it("findet die Note an einem Beat", () => {
    expect(noteAtBeat(song, -5)).toBe(-1);
    expect(noteAtBeat(song, 13)).toBe(2);
  });

  it("findet die Zeile einer Note", () => {
    expect(lineOf(song, 0)).toEqual([0, 1]);
    expect(lineOf(song, 3)).toEqual([2, 3]);
  });

  it("laesst eine Note ihre Nachbarn nicht ueberholen", () => {
    expect(moveNote(song, 1, 20).notes[1]?.beat).toBe(12);
    expect(moveNote(song, 1, -20).notes[1]?.beat).toBe(0);
    expect(updateNote(song, 2, { beat: 999 }).notes[2]?.beat).toBe(20);
    expect(shiftFrom(song, 2, -50).notes.map((n) => n.beat)).toEqual([0, 4, 4, 12]);
  });

  it("liefert ohne echte Aenderung denselben Song", () => {
    expect(updateNote(song, 0, { pitch: 5 })).toBe(song);
    expect(moveNote(song, 0, 0)).toBe(song);
    expect(shiftFrom(song, 0, 0)).toBe(song);
    // Already touching its neighbour: the clamped move is no move.
    const anliegend = updateNote(song, 1, { beat: 0 });
    expect(shiftFrom(anliegend, 1, -5)).toBe(anliegend);
  });

  it("setzt mehrere Toene in einem Schritt", () => {
    const neu = setPitches(song, new Map([[0, 2], [2, 9], [9, 1]]));
    expect(neu.notes.map((n) => n.pitch)).toEqual([2, 7, 9, 9]);
    expect(setPitches(song, new Map([[2, 9]]))).toBe(song);
  });

  it("ignoriert ungueltige Indizes", () => {
    expect(updateNote(song, 9, { pitch: 0 })).toBe(song);
    expect(mergeWithNext(song, 3)).toBe(song);
  });
});

describe("unsichere Stellen", () => {
  // Two doubted runs: notes 1-2 and note 4.
  const spur: Track = {
    notes: [
      { type: ":", beat: 0, length: 2, pitch: 0, syllable: "a" },
      { type: ":", beat: 2, length: 2, pitch: 0, syllable: "b", unsure: "interpolated" },
      { type: ":", beat: 4, length: 2, pitch: 0, syllable: "c", unsure: "interpolated" },
      { type: ":", beat: 6, length: 2, pitch: 0, syllable: "d" },
      { type: ":", beat: 8, length: 2, pitch: 0, syllable: "e", unsure: "low" },
    ],
  };

  it("findet Laeufe und zaehlt sie", () => {
    expect(unsureRun(spur, 2)).toEqual([1, 2]);
    expect(unsureRun(spur, 0)).toBeNull();
    expect(unsureRunCount(spur)).toBe(2);
  });

  it("springt von Lauf zu Lauf und wieder an den Anfang", () => {
    expect(nextUnsure(spur, null)).toBe(1);
    expect(nextUnsure(spur, 1)).toBe(4);
    expect(nextUnsure(spur, 4)).toBe(1);
    expect(nextUnsure(spur, 3)).toBe(4);
    expect(nextUnsure({ notes: [] }, null)).toBe(-1);
  });

  it("hakt einen ganzen Lauf ab, den anderen nicht", () => {
    const neu = markChecked(spur, 2);
    expect(neu.notes.map((n) => n.unsure)).toEqual([undefined, undefined, undefined, undefined, "low"]);
    expect(markChecked(spur, 0)).toBe(spur);
  });

  it("trennt aneinanderstossende Zweifel verschiedener Art", () => {
    const gemischt: Track = {
      notes: spur.notes.map((n, i) => (i === 3 ? { ...n, unsure: "low" as const } : n)),
    };
    // 1-2 interpolated, 3-4 low: two stretches, each checked off on its own.
    expect(unsureRunCount(gemischt)).toBe(2);
    expect(unsureRun(gemischt, 3)).toEqual([3, 4]);
    expect(nextUnsure(gemischt, 1)).toBe(3);
    expect(markChecked(gemischt, 2).notes.map((n) => n.unsure)).toEqual([
      undefined,
      undefined,
      undefined,
      "low",
      "low",
    ]);
  });

  it("nimmt den Zweifel beim Teilen und Verbinden mit", () => {
    expect(splitNote(spur, 4).notes.slice(4).map((n) => n.unsure)).toEqual(["low", "low"]);
    expect(mergeWithNext(spur, 3).notes[3]?.unsure).toBe("low");
  });
});
