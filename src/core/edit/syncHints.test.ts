// src/core/edit/syncHints.test.ts
import { describe, expect, it } from "bun:test";
import type { SongData } from "../create/songData.ts";
import type { Track } from "./songTxt.ts";
import {
  applySyncHints,
  buildSyncHints,
  collectSyncHints,
  parseSyncHints,
  serializeSyncHints,
} from "./syncHints.ts";

const note = (beat: number, confidence?: number) => ({
  beat,
  length: 2,
  pitch: 0,
  syllable: "x",
  ...(confidence === undefined ? {} : { confidence }),
});

const daten = (notes: SongData["notes"], sections: SongData["sections"] = []): SongData => ({
  schemaVersion: 2,
  bpm: 300,
  gap: 0,
  language: "de",
  notes,
  lineBreaks: [],
  sections,
  meta: { durationSec: 1, device: "cpu", stageVersions: {}, warnings: [], lowConfidence: false },
});

describe("buildSyncHints", () => {
  it("fasst schwache Noten zu Bereichen zusammen", () => {
    const d = daten([note(0, 0.9), note(2, 0.3), note(4, 0.5), note(6, 0.9), note(8, 0.1)]);
    expect(buildSyncHints(d)).toEqual([
      { fromBeat: 2, toBeat: 6, kind: "low" },
      { fromBeat: 8, toBeat: 10, kind: "low" },
    ]);
  });

  it("stellt interpolierte Abschnitte ueber schwache Messungen", () => {
    const d = daten(
      [note(0, 0.2), note(2, 0.2), note(4, 0.2)],
      [
        { fromNoteIndex: 0, toNoteIndex: 2, confidence: 0, anchoredBothSides: false },
        { fromNoteIndex: 2, toNoteIndex: 3, confidence: 0.4, anchoredBothSides: true },
      ],
    );
    expect(buildSyncHints(d)).toEqual([
      { fromBeat: 0, toBeat: 4, kind: "interpolated" },
      { fromBeat: 4, toBeat: 6, kind: "low" },
    ]);
  });

  it("macht auch Noten der Laenge 0 zu einem Bereich, der das Laden uebersteht", () => {
    const d = daten([{ ...note(10, 0.1), length: 0.3 }]);
    const hints = buildSyncHints(d);
    expect(hints).toEqual([{ fromBeat: 10, toBeat: 11, kind: "low" }]);
    expect(parseSyncHints(JSON.parse(serializeSyncHints(hints)))).toEqual(hints);
  });

  it("rundet Beats wie writeSongTxt", () => {
    expect(buildSyncHints(daten([note(2.6, 0.1)]))).toEqual([
      { fromBeat: 3, toBeat: 5, kind: "low" },
    ]);
  });

  it("erzeugt fuer eine sichere Erstellung keine Hinweise", () => {
    expect(buildSyncHints(daten([note(0, 0.95), note(2)]))).toEqual([]);
  });
});

describe("Datei", () => {
  it("liest zurueck, was sie schreibt", () => {
    const hints = [{ fromBeat: 2, toBeat: 6, kind: "low" as const }];
    expect(parseSyncHints(JSON.parse(serializeSyncHints(hints)))).toEqual(hints);
  });

  it("verwirft fremde Versionen und kaputte Eintraege", () => {
    expect(parseSyncHints({ version: 2, hints: [{ fromBeat: 0, toBeat: 2, kind: "low" }] })).toEqual([]);
    expect(
      parseSyncHints({
        version: 1,
        hints: [
          { fromBeat: 0, toBeat: 2, kind: "low" },
          { fromBeat: 4, toBeat: 4, kind: "low" },
          { fromBeat: 5, toBeat: 6, kind: "boese" },
          null,
        ],
      }),
    ).toEqual([{ fromBeat: 0, toBeat: 2, kind: "low" }]);
    expect(parseSyncHints("Quatsch")).toEqual([]);
  });
});

describe("Noten und Bereiche", () => {
  const spur: Track = {
    notes: [0, 2, 4, 6].map((beat) => ({ type: ":", beat, length: 2, pitch: 0, syllable: "x" })),
  };

  it("legt Bereiche auf die Noten und sammelt sie wieder ein", () => {
    const hints = [
      { fromBeat: 2, toBeat: 6, kind: "interpolated" as const },
      { fromBeat: 6, toBeat: 8, kind: "low" as const },
    ];
    const markiert = applySyncHints(spur, hints);
    expect(markiert.notes.map((n) => n.unsure)).toEqual([undefined, "interpolated", "interpolated", "low"]);
    expect(collectSyncHints(markiert)).toEqual(hints);
  });
});
