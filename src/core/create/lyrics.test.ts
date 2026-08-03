// src/core/create/lyrics.test.ts
import { describe, expect, it } from "bun:test";
import { normalizeLyrics, resolveLyrics } from "./lyrics.ts";

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

describe("resolveLyrics", () => {
  it("doppelt nur die Zeile", () => {
    expect(
      resolveLyrics("Zeile A\nZeile B 2x", [
        { kind: "repeat_scope", zeilenIndex: 1, wahl: "zeile" },
      ]),
    ).toEqual(["Zeile A", "Zeile B", "Zeile B"]);
  });

  it("doppelt den ganzen Block", () => {
    expect(
      resolveLyrics("Zeile A\nZeile B (2x)", [
        { kind: "repeat_scope", zeilenIndex: 1, wahl: "block" },
      ]),
    ).toEqual(["Zeile A", "Zeile B", "Zeile A", "Zeile B"]);
  });

  it("setzt den Refrain ein", () => {
    const raw = "Ref 1\nRef 2\n\nStrophe\n\n[Chorus]";
    expect(
      resolveLyrics(raw, [
        { kind: "chorus_reference", zeilenIndex: 5, wahl: "einsetzen" },
      ]),
    ).toEqual(["Ref 1", "Ref 2", "Strophe", "Ref 1", "Ref 2"]);
  });

  it("verwirft den Verweis auf Wunsch", () => {
    const raw = "Ref 1\nRef 2\n\nStrophe\n\n[Chorus]";
    expect(
      resolveLyrics(raw, [
        { kind: "chorus_reference", zeilenIndex: 5, wahl: "verwerfen" },
      ]),
    ).toEqual(["Ref 1", "Ref 2", "Strophe"]);
  });

  it("lehnt einsetzen ohne Vorlage ab", () => {
    expect(() =>
      resolveLyrics("[Chorus]", [
        { kind: "chorus_reference", zeilenIndex: 0, wahl: "einsetzen" },
      ]),
    ).toThrow(/nichts einzusetzen/);
  });

  it("lehnt eine unbeantwortete Frage ab", () => {
    expect(() => resolveLyrics("Zeile A\nZeile B 2x", [])).toThrow(
      /Unbeantwortete/,
    );
  });

  it("beantwortet mehrere Fragen in einem Text", () => {
    const raw = "A\nB 2x\n\nC\n\n[Chorus]";
    expect(normalizeLyrics(raw).offeneFragen).toHaveLength(2);
    expect(
      resolveLyrics(raw, [
        { kind: "repeat_scope", zeilenIndex: 1, wahl: "zeile" },
        { kind: "chorus_reference", zeilenIndex: 5, wahl: "einsetzen" },
      ]),
    ).toEqual(["A", "B", "B", "C", "A", "B", "B"]);
  });
});
