// src/core/create/writeSongTxt.test.ts
import { describe, expect, it } from "bun:test";
import type { SongData } from "./songData.ts";
import { renderSongTxt } from "./writeSongTxt.ts";

const daten: SongData = {
  schemaVersion: 2,
  bpm: 294.5,
  gap: 1200,
  language: "German",
  notes: [
    { beat: 0, length: 4, pitch: 5, syllable: "Hal" },
    { beat: 4, length: 4, pitch: 7, syllable: "lo" },
    { beat: 16, length: 8, pitch: 9, syllable: "Welt" },
  ],
  lineBreaks: [{ afterNoteIndex: 1, beat: 12 }],
  sections: [],
  meta: {
    durationSec: 10,
    device: "cpu",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
};

const headers = { artist: "Testkuenstler", title: "Testlied", mp3: "Testlied.ogg" };

describe("renderSongTxt", () => {
  it("schreibt Pflicht-Header zuerst", () => {
    const zeilen = renderSongTxt(daten, headers).split("\n");
    expect(zeilen[0]).toBe("#TITLE:Testlied");
    expect(zeilen[1]).toBe("#ARTIST:Testkuenstler");
    expect(zeilen).toContain("#MP3:Testlied.ogg");
  });

  it("schreibt BPM mit Punkt und GAP als ganze Zahl", () => {
    const txt = renderSongTxt(daten, headers);
    expect(txt).toContain("#BPM:294.5");
    expect(txt).toContain("#GAP:1200");
  });

  it("schreibt Notenzeilen als ': beat length pitch silbe'", () => {
    const txt = renderSongTxt(daten, headers);
    expect(txt).toContain(": 0 4 5 Hal");
    expect(txt).toContain(": 4 4 7 lo");
  });

  it("setzt den Zeilenumbruch als '- beat' an der richtigen Stelle", () => {
    const zeilen = renderSongTxt(daten, headers).split("\n");
    const iLo = zeilen.indexOf(": 4 4 7 lo");
    const iWelt = zeilen.indexOf(": 16 8 9 Welt");
    const iBreak = zeilen.indexOf("- 12");
    expect(iBreak).toBeGreaterThan(iLo);
    expect(iBreak).toBeLessThan(iWelt);
  });

  it("endet mit E und Zeilenumbruch", () => {
    expect(renderSongTxt(daten, headers).endsWith("E\n")).toBe(true);
  });

  it("laesst optionale Header weg, wenn nicht gesetzt", () => {
    const txt = renderSongTxt(daten, headers);
    expect(txt).not.toContain("#GENRE:");
    expect(txt).not.toContain("#YEAR:");
  });

  it("schreibt optionale Header, wenn gesetzt", () => {
    const txt = renderSongTxt(daten, { ...headers, genre: "Pop", year: 1987, cover: "c.jpg" });
    expect(txt).toContain("#GENRE:Pop");
    expect(txt).toContain("#YEAR:1987");
    expect(txt).toContain("#COVER:c.jpg");
  });

  it("schreibt die Sprache als Namen, auch wenn der Job den Code traegt", () => {
    // Der Job muss den ISO-Code fuehren, weil whisper nur den kennt. In der
    // Kopfzeile hat er nichts zu suchen: die Songdatenbank schreibt Namen.
    expect(renderSongTxt(daten, { ...headers, language: "de" })).toContain(
      "#LANGUAGE:German",
    );
    expect(renderSongTxt(daten, { ...headers, language: "en" })).toContain(
      "#LANGUAGE:English",
    );
    // Ein Name, den wir nicht kennen, bleibt unangetastet.
    expect(
      renderSongTxt(daten, { ...headers, language: "Schwyzerduetsch" }),
    ).toContain("#LANGUAGE:Schwyzerduetsch");
  });

  it("traegt zwischen zwei Woertern derselben Zeile ein Leerzeichen", () => {
    // notes.py haengt das Trennzeichen an die letzte Silbe eines Wortes an
    // ("lo "); writeSongTxt.ts schreibt die Silbe nur verbatim durch. Ohne
    // dieses trailing space wuerden "Hallo" und "Welt" beim Zusammenfuegen
    // der Silben zu "HalloWelt" verschmelzen.
    const zweiWoerterEineZeile: SongData = {
      schemaVersion: 2,
      bpm: 120,
      gap: 0,
      language: "de",
      notes: [
        { beat: 0, length: 2, pitch: 0, syllable: "Hal" },
        { beat: 2, length: 2, pitch: 2, syllable: "lo " },
        { beat: 4, length: 4, pitch: 4, syllable: "Welt" },
      ],
      lineBreaks: [],
      sections: [],
      meta: {
        durationSec: 1,
        device: "cpu",
        stageVersions: {},
        warnings: [],
        lowConfidence: false,
      },
    };
    const noten = renderSongTxt(zweiWoerterEineZeile, headers)
      .split("\n")
      .filter((z) => z.startsWith(": "));
    const text = noten.map((z) => z.replace(/^: -?\d+ \d+ -?\d+ /, "")).join("");
    expect(text).toBe("Hallo Welt");
  });

  it("erzeugt eine vollstaendige, stabile Ausgabe", () => {
    expect(renderSongTxt(daten, headers)).toBe(
      [
        "#TITLE:Testlied",
        "#ARTIST:Testkuenstler",
        "#MP3:Testlied.ogg",
        "#LANGUAGE:German",
        "#BPM:294.5",
        "#GAP:1200",
        ": 0 4 5 Hal",
        ": 4 4 7 lo",
        "- 12",
        ": 16 8 9 Welt",
        "E",
        "",
      ].join("\n"),
    );
  });
});
