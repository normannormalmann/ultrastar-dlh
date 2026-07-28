// src/core/create/songData.test.ts
import { describe, expect, it } from "bun:test";
import { parseSongData, SCHEMA_VERSION } from "./songData.ts";

const gueltig = {
  schemaVersion: 2,
  bpm: 294.5,
  gap: 1200,
  language: "de",
  notes: [{ beat: 0, length: 4, pitch: 5, syllable: "Hal", confidence: 0.91 }],
  lineBreaks: [{ afterNoteIndex: 0, beat: 32 }],
  meta: {
    durationSec: 214.3,
    device: "cuda",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
};

describe("parseSongData", () => {
  it("nimmt gueltige Daten an", () => {
    const d = parseSongData(gueltig);
    expect(d.bpm).toBe(294.5);
    expect(d.notes[0]?.syllable).toBe("Hal");
    expect(SCHEMA_VERSION).toBe(2);
  });

  it("lehnt unbekannte schemaVersion ab, ohne teilweise zu parsen", () => {
    expect(() => parseSongData({ ...gueltig, schemaVersion: 3 })).toThrow(/schemaVersion/);
  });

  it("lehnt fehlende Noten ab", () => {
    expect(() => parseSongData({ ...gueltig, notes: [] })).toThrow(/notes/);
  });

  it("lehnt nicht-numerischen Beat ab", () => {
    const kaputt = { ...gueltig, notes: [{ ...gueltig.notes[0], beat: "0" }] };
    expect(() => parseSongData(kaputt)).toThrow(/beat/);
  });

  it("lehnt Nicht-Objekte ab", () => {
    expect(() => parseSongData(null)).toThrow();
    expect(() => parseSongData("nope")).toThrow();
  });

  it("erlaubt fehlende optionale Konfidenz", () => {
    const ohne = { ...gueltig, notes: [{ beat: 0, length: 4, pitch: 5, syllable: "Hal" }] };
    expect(parseSongData(ohne).notes[0]?.confidence).toBeUndefined();
  });

  it("lehnt fehlende lineBreaks ab", () => {
    const { lineBreaks, ...ohneLineBreaks } = gueltig;
    expect(() => parseSongData(ohneLineBreaks)).toThrow(/lineBreaks/);
  });

  it("lehnt nicht-Array lineBreaks ab", () => {
    expect(() => parseSongData({ ...gueltig, lineBreaks: "nope" })).toThrow(/lineBreaks/);
  });

  it("erlaubt leere lineBreaks", () => {
    expect(parseSongData({ ...gueltig, lineBreaks: [] }).lineBreaks).toEqual([]);
  });

  it("lehnt eine Silbe mit Zeilenumbruch ab", () => {
    const kaputt = {
      ...gueltig,
      notes: [{ ...gueltig.notes[0], syllable: "Hal\nlo" }],
    };
    expect(() => parseSongData(kaputt)).toThrow(/Zeilenumbruch/);
  });

  it("wandelt stageVersions-Werte in Strings um", () => {
    const d = parseSongData({
      ...gueltig,
      meta: { ...gueltig.meta, stageVersions: { separate: 1 } },
    });
    expect(d.meta.stageVersions).toEqual({ separate: "1" });
  });

  it("liest fehlendes sections als leere Liste", () => {
    expect(parseSongData(gueltig).sections).toEqual([]);
  });

  it("nimmt gueltige sections an", () => {
    const mit = {
      ...gueltig,
      sections: [{ fromNoteIndex: 0, toNoteIndex: 1, confidence: 0.75, anchoredBothSides: true }],
    };
    expect(parseSongData(mit).sections).toEqual([
      { fromNoteIndex: 0, toNoteIndex: 1, confidence: 0.75, anchoredBothSides: true },
    ]);
  });

  it("lehnt sections mit Index ausserhalb der Notenanzahl ab", () => {
    const kaputt = {
      ...gueltig,
      sections: [{ fromNoteIndex: 0, toNoteIndex: 999, confidence: 1, anchoredBothSides: true }],
    };
    expect(() => parseSongData(kaputt)).toThrow();
  });

  it("lehnt sections mit verdrehten Grenzen ab", () => {
    const kaputt = {
      ...gueltig,
      sections: [{ fromNoteIndex: 3, toNoteIndex: 1, confidence: 1, anchoredBothSides: true }],
    };
    expect(() => parseSongData(kaputt)).toThrow();
  });

  it("lehnt confidence ausserhalb von 0..1 ab", () => {
    const kaputt = {
      ...gueltig,
      sections: [{ fromNoteIndex: 0, toNoteIndex: 1, confidence: 1.5, anchoredBothSides: true }],
    };
    expect(() => parseSongData(kaputt)).toThrow();
  });

  it("lehnt nicht-boolesches anchoredBothSides ab", () => {
    const kaputt = {
      ...gueltig,
      sections: [{ fromNoteIndex: 0, toNoteIndex: 1, confidence: 1, anchoredBothSides: "ja" }],
    };
    expect(() => parseSongData(kaputt)).toThrow();
  });

  it("lehnt nicht-Array sections ab", () => {
    expect(() => parseSongData({ ...gueltig, sections: "nope" })).toThrow(/sections/);
  });
});
