// src/core/edit/songTxt.test.ts
import { describe, expect, it } from "bun:test";
import { renderSongTxt } from "../create/writeSongTxt.ts";
import {
  BOM,
  beatToMs,
  headerNumber,
  headerValue,
  type Track,
  trackName,
  msToBeat,
  parseSongTxt,
  type EditNote,
  type SongTxt,
  SongTxtError,
  serializeSongTxt,
  timingOf,
  withHeader,
} from "./songTxt.ts";

const BEISPIEL = [
  "#TITLE:Testlied",
  "#ARTIST:Testkuenstler",
  "#MP3:audio.mp3",
  "#CUSTOMTAG:bleibt",
  "#BPM:300",
  "#GAP:1000",
  ": 0 4 5 Hal",
  "* 4 4 7 lo",
  "- 10",
  "F 12 2 0  Welt",
  "R 16 3 -2 ~",
  "E",
  "",
].join("\n");

const noten = (s: SongTxt): EditNote[] => s.tracks[0]?.notes ?? [];
const mitNoten = (s: SongTxt, notes: EditNote[]): SongTxt => ({
  ...s,
  tracks: [{ ...s.tracks[0], notes }],
});

const fehlerCode = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof SongTxtError ? e.code : "anderer Fehler";
  }
  return undefined;
};

describe("parseSongTxt", () => {
  it("liest Header in Reihenfolge, Noten und Umbrueche", () => {
    const song = parseSongTxt(BEISPIEL);
    expect(song.headers.map((h) => h.key)).toEqual([
      "TITLE",
      "ARTIST",
      "MP3",
      "CUSTOMTAG",
      "BPM",
      "GAP",
    ]);
    expect(noten(song)).toHaveLength(4);
    expect(noten(song)[1]).toEqual({
      type: "*",
      beat: 4,
      length: 4,
      pitch: 7,
      syllable: "lo",
      breakAfter: { beat: 10 },
    });
    expect(noten(song)[3]?.pitch).toBe(-2);
  });

  it("behaelt das Leerzeichen vor einer Silbe", () => {
    expect(noten(parseSongTxt(BEISPIEL))[2]?.syllable).toBe(" Welt");
  });

  it("schreibt eine unveraenderte Datei Zeichen fuer Zeichen zurueck", () => {
    expect(serializeSongTxt(parseSongTxt(BEISPIEL))).toBe(BEISPIEL);
  });

  it("behaelt CRLF-Zeilenenden und ignoriert ein BOM", () => {
    const crlf = BEISPIEL.replaceAll("\n", "\r\n");
    const song = parseSongTxt(`${BOM}${crlf}`);
    expect(song.eol).toBe("\r\n");
    expect(serializeSongTxt(song)).toBe(crlf);
  });

  it("liest Umbrueche mit zwei Zahlen", () => {
    const song = parseSongTxt(BEISPIEL.replace("- 10", "- 9 11"));
    expect(noten(song)[1]?.breakAfter).toEqual({ beat: 9, end: 11 });
    expect(serializeSongTxt(song)).toContain("- 9 11");
  });

  it("behaelt alles nach E unveraendert", () => {
    const mitRest = `${BEISPIEL}Kommentar am Ende\n: 99 1 1 keine Note\n`;
    const song = parseSongTxt(mitRest);
    expect(noten(song)).toHaveLength(4);
    expect(serializeSongTxt(song)).toBe(mitRest);
  });

  it("behaelt Schreibweise und Leerzeichen eines Kopfzeilen-Schluessels", () => {
    const txt = BEISPIEL.replace("#CUSTOMTAG:bleibt", "#Author Name:jemand");
    const song = parseSongTxt(txt);
    expect(headerValue(song, "AUTHOR NAME")).toBe("jemand");
    expect(serializeSongTxt(song)).toBe(txt);
    expect(serializeSongTxt(withHeader(song, "author name", "x"))).toContain(
      "#Author Name:x",
    );
  });

  it("schreibt Noten der Laenge 0 zurueck", () => {
    const txt = BEISPIEL.replace("R 16 3 -2 ~", "R 16 0 -2 ~");
    expect(serializeSongTxt(parseSongTxt(txt))).toBe(txt);
  });

  it("laesst einen Umbruch innerhalb seiner Note stehen", () => {
    const txt = BEISPIEL.replace("- 10", "- 6");
    expect(serializeSongTxt(parseSongTxt(txt))).toBe(txt);
  });

  it("liest Duette als Spuren und schreibt sie unveraendert zurueck", () => {
    const duett = [
      "#TITLE:Duett",
      "#BPM:300",
      "#P1:Anna",
      "#P2:Ben",
      "P1",
      ": 0 4 5 Hal",
      "- 6",
      ": 8 4 7 lo",
      "P2",
      ": 2 4 1 du",
      "E",
      "",
    ].join("\n");
    const song = parseSongTxt(duett);
    expect(song.tracks.map((t) => t.marker)).toEqual(["P1", "P2"]);
    expect(song.tracks.map((t) => t.notes.length)).toEqual([2, 1]);
    expect(trackName(song, song.tracks[1] as Track)).toBe("Ben");
    expect(serializeSongTxt(song)).toBe(duett);
  });

  it("findet Saengernamen auch im alten DUETSINGER-Format", () => {
    const song = parseSongTxt("#BPM:300\n#DUETSINGERP1:Alt\nP1\n: 0 1 1 a\nE\n");
    expect(trackName(song, song.tracks[0] as Track)).toBe("Alt");
  });

  it("zaehlt in RELATIVE-Duetten jede Stimme fuer sich weiter", () => {
    const relativ = [
      "#RELATIVE:yes",
      "#BPM:300",
      "P1",
      ": 0 2 0 a",
      "- 4 10",
      "P2",
      ": 0 2 0 b",
      "P 1",
      ": 1 2 0 c",
      "E",
      "",
    ].join("\n");
    const song = parseSongTxt(relativ);
    // P1 went on at 10 after its break; P2 started at 0; "P 1" is P1 again.
    expect(song.tracks.map((t) => t.notes.map((n) => n.beat))).toEqual([[0], [0], [11]]);
    const zurueck = parseSongTxt(serializeSongTxt(song));
    expect(zurueck.tracks.map((t) => t.notes.map((n) => n.beat))).toEqual([[0], [0], [11]]);
  });

  it("rechnet RELATIVE-Dateien in absolute Beats um und zurueck", () => {
    const relativ = [
      "#RELATIVE:yes",
      "#BPM:300",
      ": 0 4 5 Hal",
      ": 4 4 7 lo",
      "- 10 12",
      ": 0 4 9 Welt",
      ": 6 2 9 ~",
      "E",
      "",
    ].join("\n");
    const song = parseSongTxt(relativ);
    expect(song.relative).toBe(true);
    expect(noten(song).map((n) => n.beat)).toEqual([0, 4, 12, 18]);
    expect(noten(song)[1]?.breakAfter).toEqual({ beat: 10 });
    // Written back relative; the next line now counts from the break itself.
    const zurueck = serializeSongTxt(song);
    expect(zurueck).toContain("- 10 10\n: 2 4 9 Welt\n: 8 2 9 ~\n");
    expect(noten(parseSongTxt(zurueck)).map((n) => n.beat)).toEqual([0, 4, 12, 18]);
  });

  it("meldet eine kaputte Zeile mit Zeilennummer", () => {
    try {
      parseSongTxt(BEISPIEL.replace("* 4 4 7 lo", "Quatsch"));
      throw new Error("kein Fehler");
    } catch (e) {
      expect(e).toBeInstanceOf(SongTxtError);
      expect((e as SongTxtError).code).toBe("badLine");
      expect((e as SongTxtError).line).toBe(8);
    }
  });

  it("lehnt eine Datei ohne Noten ab", () => {
    expect(fehlerCode(() => parseSongTxt("#TITLE:x\n#BPM:300\nE\n"))).toBe(
      "noNotes",
    );
  });

  it("liest Dateien, die writeSongTxt selbst erzeugt", () => {
    const txt = renderSongTxt(
      {
        schemaVersion: 2,
        bpm: 294.5,
        gap: 1200,
        language: "de",
        notes: [
          { beat: 0, length: 4, pitch: 5, syllable: "Hal" },
          { beat: 4, length: 4, pitch: 7, syllable: "lo" },
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
      },
      { artist: "A", title: "T", mp3: "audio.mp3" },
    );
    const song = parseSongTxt(txt);
    expect(headerNumber(song, "BPM")).toBe(294.5);
    expect(serializeSongTxt(song)).toBe(txt);
  });
});

describe("serializeSongTxt", () => {
  it("zieht einen Umbruch hinter der naechsten Note ans Notenende zurueck", () => {
    const song = parseSongTxt(BEISPIEL);
    const notes = noten(song).map((n, i) =>
      i === 1 ? { ...n, breakAfter: { beat: 50 } } : n,
    );
    expect(serializeSongTxt(mitNoten(song, notes))).toContain("- 8\n");
  });

  it("verweigert Zeilenumbrueche im Rest nach E", () => {
    const song = { ...parseSongTxt(BEISPIEL), trailer: ["a\nb"] };
    expect(fehlerCode(() => serializeSongTxt(song))).toBe("badValue");
  });

  it("verweigert Zeilenumbrueche in Silben und Kopfzeilen", () => {
    const song = parseSongTxt(BEISPIEL);
    const kaputt = noten(song).map((n, i) =>
      i === 0 ? { ...n, syllable: "a\nb" } : n,
    );
    expect(fehlerCode(() => serializeSongTxt(mitNoten(song, kaputt)))).toBe(
      "badValue",
    );
    expect(
      fehlerCode(() => serializeSongTxt(withHeader(song, "TITLE", "x\r\n#GAP:0"))),
    ).toBe("badHeader");
  });

  it("verweigert Kommazahlen und negative Laengen", () => {
    const song = parseSongTxt(BEISPIEL);
    for (const patch of [{ beat: 1.5 }, { length: -1 }]) {
      const notes = noten(song).map((n, i) => (i === 0 ? { ...n, ...patch } : n));
      expect(fehlerCode(() => serializeSongTxt(mitNoten(song, notes)))).toBe(
        "badValue",
      );
    }
  });
});

describe("Zeitrechnung", () => {
  it("liest GAP mit Dezimalkomma", () => {
    const song = withHeader(parseSongTxt(BEISPIEL), "GAP", "1200,5");
    expect(timingOf(song)).toEqual({ bpm: 300, gap: 1200.5 });
  });

  it("rechnet Beats in Millisekunden und zurueck", () => {
    const t = { bpm: 300, gap: 1000 };
    // 300 BPM sind 1200 Viertelbeats pro Minute, also 50 ms je Beat.
    expect(beatToMs(t, 4)).toBe(1200);
    expect(msToBeat(t, 1200)).toBe(4);
  });

  it("liefert ohne gueltige BPM kein Timing", () => {
    expect(timingOf(withHeader(parseSongTxt(BEISPIEL), "BPM", "0"))).toBeNull();
  });
});
