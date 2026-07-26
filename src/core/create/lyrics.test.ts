// src/core/create/lyrics.test.ts
import { describe, expect, it } from "bun:test";
import { normalizeLyrics } from "./lyrics.ts";

describe("normalizeLyrics", () => {
  it("entfernt lrc-Zeitstempel", () => {
    const r = normalizeLyrics("[00:12.34]Hallo Welt");
    expect(r.lines).toEqual(["Hallo Welt"]);
    expect(r.offeneFragen).toEqual([]);
  });

  it("entfernt Ueberschriften mit folgendem Text", () => {
    const r = normalizeLyrics("[Verse 1]\nZeile eins\nZeile zwei");
    expect(r.lines).toEqual(["Zeile eins", "Zeile zwei"]);
    expect(r.entfernt).toContain("[Verse 1]");
    expect(r.offeneFragen).toEqual([]);
  });

  it("fragt bei alleinstehendem [Chorus] mit frueherem Refrain", () => {
    const r = normalizeLyrics("[Chorus]\nRefrain hier\n\nStrophe\n\n[Chorus]");
    expect(r.offeneFragen).toHaveLength(1);
    const frage = r.offeneFragen[0];
    expect(frage?.kind).toBe("chorus_reference");
    if (frage?.kind === "chorus_reference") {
      expect(frage.refrainZeilen).toEqual(["Refrain hier"]);
    }
  });

  it("fragt bei (2x) nach Zeile oder Block", () => {
    const r = normalizeLyrics("Erste Zeile\nZweite Zeile (2x)");
    expect(r.offeneFragen).toHaveLength(1);
    const frage = r.offeneFragen[0];
    expect(frage?.kind).toBe("repeat_scope");
    if (frage?.kind === "repeat_scope") {
      expect(frage.marker).toBe("(2x)");
      expect(frage.blockZeilen).toEqual(["Erste Zeile", "Zweite Zeile"]);
    }
  });

  it("erkennt auch (x2) und blankes 2x", () => {
    expect(normalizeLyrics("Zeile (x2)").offeneFragen).toHaveLength(1);
    expect(normalizeLyrics("Zeile 2x").offeneFragen).toHaveLength(1);
  });

  it("behaelt Leerzeilen als Blockgrenze bis zur Aufloesung", () => {
    const r = normalizeLyrics("A\nB\n\nC (2x)");
    const frage = r.offeneFragen[0];
    if (frage?.kind === "repeat_scope") {
      // Nur der zweite Block, nicht der erste.
      expect(frage.blockZeilen).toEqual(["C"]);
    }
  });

  it("liefert bei sauberem Text keine offenen Fragen", () => {
    const r = normalizeLyrics("Eine Zeile\nZwei Zeile\n\nDrei Zeile");
    expect(r.lines).toEqual(["Eine Zeile", "Zwei Zeile", "Drei Zeile"]);
    expect(r.offeneFragen).toEqual([]);
  });
});
