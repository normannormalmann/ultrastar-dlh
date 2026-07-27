// scripts/evaluate-pipeline.test.ts
import { describe, expect, it } from "bun:test";
import { lyricsAusReferenz } from "./evaluate-pipeline.ts";

describe("lyricsAusReferenz", () => {
  it("baut mehrere Woerter zurueck, nicht eine verschmolzene Silbe", () => {
    // Erfundene Platzhalterwoerter: das Trennzeichen zwischen Woertern ist
    // ein Leerzeichen am Ende der jeweils letzten Silbe eines Worts. Ohne
    // dieses Leerzeichen wuerden alle Silben einer Zeile zu einem Wort
    // verschmelzen (gemessen: 1,09 statt 4,49 Woerter/Zeile).
    const referenzMitTrennern = [
      "#BPM:120",
      "#GAP:0",
      ": 0 4 5 Fuu ",
      ": 4 4 5 Bar ",
      ": 8 4 5 Baz",
      "E",
      "",
    ].join("\n");

    const zeilen = lyricsAusReferenz(referenzMitTrennern);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.split(" ")).toHaveLength(3);
    expect(zeilen[0]).not.toMatch(/ {2}/);
  });

  it("verschmilzt Silben desselben Worts ohne Leerzeichen dazwischen", () => {
    const referenzOhneTrenner = [
      "#BPM:120",
      "#GAP:0",
      ": 0 4 5 Fuu",
      ": 4 4 5 bar",
      "E",
      "",
    ].join("\n");

    expect(lyricsAusReferenz(referenzOhneTrenner)).toEqual(["Fuubar"]);
  });
});
