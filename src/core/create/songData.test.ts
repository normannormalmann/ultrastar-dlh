// src/core/create/songData.test.ts
import { describe, expect, it } from "bun:test";
import { parseSongData, SCHEMA_VERSION } from "./songData.ts";

const gueltig = {
  schemaVersion: 1,
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
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("lehnt unbekannte schemaVersion ab, ohne teilweise zu parsen", () => {
    expect(() => parseSongData({ ...gueltig, schemaVersion: 2 })).toThrow(/schemaVersion/);
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

  it("wandelt stageVersions-Werte in Strings um", () => {
    const d = parseSongData({
      ...gueltig,
      meta: { ...gueltig.meta, stageVersions: { separate: 1 } },
    });
    expect(d.meta.stageVersions).toEqual({ separate: "1" });
  });
});
