// src/core/create/evaluate.test.ts
import { describe, expect, it } from "bun:test";
import { compareToReference, parseReferenceTxt } from "./evaluate.ts";

const txt = [
  "#TITLE:T",
  "#ARTIST:A",
  "#BPM:120",
  "#GAP:1000",
  ": 0 4 5 Hal",
  ": 4 4 7 lo",
  "- 12",
  ": 16 8 9 Welt",
  "E",
  "",
].join("\n");

describe("parseReferenceTxt", () => {
  it("liest BPM, GAP und Silben mit Onset und Tonhoehe", () => {
    const r = parseReferenceTxt(txt);
    expect(r.bpm).toBe(120);
    expect(r.gap).toBe(1000);
    expect(r.syllables.map((s) => s.syllable)).toEqual(["Hal", "lo", "Welt"]);
    expect(r.syllables[0]?.onsetMs).toBe(1000);
    expect(r.syllables.map((s) => s.pitch)).toEqual([5, 7, 9]);
  });

  it("versteht Komma als Dezimaltrenner im BPM", () => {
    expect(parseReferenceTxt(txt.replace("#BPM:120", "#BPM:294,5")).bpm).toBe(294.5);
  });

  it("ignoriert Umbruch- und Kopfzeilen als Silben", () => {
    expect(parseReferenceTxt(txt).syllables).toHaveLength(3);
  });
});

describe("compareToReference", () => {
  it("meldet null Abweichung bei identischen Daten", () => {
    const r = parseReferenceTxt(txt);
    const m = compareToReference(r, r);
    expect(m.medianAbweichungMs).toBe(0);
    expect(m.anteilUnter50ms).toBe(1);
    expect(m.notenzahlDifferenz).toBe(0);
  });

  it("misst eine konstante Verschiebung", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = {
      ...referenz,
      syllables: referenz.syllables.map((s) => ({ ...s, onsetMs: s.onsetMs + 80 })),
    };
    const m = compareToReference(unser, referenz);
    expect(m.medianAbweichungMs).toBeCloseTo(80, 6);
    expect(m.anteilUnter50ms).toBe(0);
    expect(m.anteilUnter100ms).toBe(1);
  });

  it("meldet abweichende Notenzahl und vergleicht nur die Schnittmenge", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = { ...referenz, syllables: referenz.syllables.slice(0, 2) };
    const m = compareToReference(unser, referenz);
    expect(m.notenzahlDifferenz).toBe(-1);
    expect(m.paare).toBe(2);
  });

  it("liefert bei leerer Eingabe keine NaN-Werte", () => {
    const leer = { bpm: 120, gap: 0, syllables: [] };
    const m = compareToReference(leer, leer);
    expect(Number.isNaN(m.medianAbweichungMs)).toBe(false);
    expect(Number.isNaN(m.medianPitchOffset)).toBe(false);
    expect(m.paare).toBe(0);
  });
});

// Nachtrag A: die Metrik muss Transposition von echten Formfehlern der
// Melodie trennen koennen — beides sieht in reinen Onset-Zahlen identisch aus.
describe("compareToReference - Tonhoehe", () => {
  it("meldet Offset 0 und Anteil 1 bei identischen Tonhoehen", () => {
    const r = parseReferenceTxt(txt);
    const m = compareToReference(r, r);
    expect(m.medianPitchOffset).toBe(0);
    expect(m.anteilPitchExakt).toBe(1);
  });

  it("misst eine konstante Transposition um drei Halbtoene", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = {
      ...referenz,
      syllables: referenz.syllables.map((s) => ({ ...s, pitch: s.pitch + 3 })),
    };
    const m = compareToReference(unser, referenz);
    expect(m.medianPitchOffset).toBe(3);
    expect(m.anteilPitchExakt).toBe(1);
  });

  it("eine einzelne verfaelschte Note senkt nur den Anteil, nicht den Offset", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = {
      ...referenz,
      syllables: referenz.syllables.map((s, i) => (i === 0 ? { ...s, pitch: s.pitch + 5 } : s)),
    };
    const m = compareToReference(unser, referenz);
    expect(m.medianPitchOffset).toBe(0);
    expect(m.anteilPitchExakt).toBeCloseTo(2 / 3, 6);
  });
});
