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

describe("lyricsAusReferenz: Duette", () => {
  it("ordnet die Zeilen eines Duetts nach Zeit, damit die Pipeline dieselbe Folge sieht wie der Vergleich", () => {
    // parseReferenceTxt sortiert die Referenzsilben eines Duetts nach
    // Onset. Bekaeme die Pipeline die Lyrics weiter blockweise (P1, dann
    // P2), wuerde sie Text in einer Reihenfolge ausrichten, in der er nie
    // gesungen wird, und der Vergleich misst Alignment-Fehler, die keine
    // sind.
    const duett = [
      "#BPM:120",
      "#GAP:0",
      "P1",
      ": 0 4 5 Eins ",
      "- 4",
      ": 8 4 5 Drei ",
      "P2",
      ": 4 4 5 Zwei ",
      "E",
      "",
    ].join("\n");

    expect(lyricsAusReferenz(duett)).toEqual(["Eins", "Zwei", "Drei"]);
  });

  it("beginnt beim Stimmenwechsel eine neue Zeile, auch ohne Umbruchzeile davor", () => {
    const duett = ["#BPM:120", "P1", ": 0 4 5 Eins ", "P2", ": 4 4 5 Zwei ", "E", ""].join("\n");

    expect(lyricsAusReferenz(duett)).toEqual(["Eins", "Zwei"]);
  });
});
