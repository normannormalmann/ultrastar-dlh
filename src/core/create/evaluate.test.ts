// src/core/create/evaluate.test.ts
import { describe, expect, it, test } from "bun:test";
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

  it("behaelt das trennende Leerzeichen einer Silbe verbatim", () => {
    // Das Format kodiert ein Wortende als Leerzeichen am Ende der letzten
    // Silbe. trimEnd() vor dem Regex-Match wuerde genau das verschlucken
    // und beim Zusammenbau der Lyrics Woerter verschmelzen lassen.
    const zeilenMitTrenner = [
      "#BPM:120",
      "#GAP:0",
      ": 0 4 5 Fuu ",
      ": 4 4 5 bar",
      "E",
      "",
    ].join("\n");
    const r = parseReferenceTxt(zeilenMitTrenner);
    expect(r.syllables[0]?.syllable).toBe("Fuu ");
    expect(r.syllables[1]?.syllable).toBe("bar");
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

  // medianPitchOffset ist vorzeichenbehaftet: eine Implementierung, die die
  // Differenzen durch Betrag jagt, wuerde alle bisherigen Tests bestehen und
  // trotzdem eine Transposition abwaerts nicht von einer aufwaerts
  // unterscheiden koennen. Diese beiden Faelle pruefen genau das Vorzeichen.
  it("misst eine konstante Transposition um vier Halbtoene abwaerts", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = {
      ...referenz,
      syllables: referenz.syllables.map((s) => ({ ...s, pitch: s.pitch - 4 })),
    };
    const m = compareToReference(unser, referenz);
    expect(m.medianPitchOffset).toBe(-4);
    expect(m.anteilPitchExakt).toBe(1);
  });

  it("eine einzelne abwaerts verfaelschte Note senkt nur den Anteil, nicht den Offset", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = {
      ...referenz,
      syllables: referenz.syllables.map((s, i) => (i === 0 ? { ...s, pitch: s.pitch - 5 } : s)),
    };
    const m = compareToReference(unser, referenz);
    expect(m.medianPitchOffset).toBe(0);
    expect(m.anteilPitchExakt).toBeCloseTo(2 / 3, 6);
  });
});

// Nachtrag C: medianAbweichungMs nimmt den Betrag der Differenz und kann
// deshalb einen konstanten Versatz nicht von lokalem Verrutschen
// unterscheiden. medianVersatzMs (vorzeichenbehaftet) und driftProfil
// (Mittelwert je Zehntel) schliessen diese Luecke.
describe("compareToReference - Versatz und Drift", () => {
  const songMitOnsets = (onsets: number[]) => ({
    bpm: 60,
    gap: 0,
    syllables: onsets.map((onsetMs, i) => ({ syllable: `s${i}`, onsetMs, pitch: 0 })),
  });

  test("medianVersatzMs zeigt das Vorzeichen einer konstanten Verschiebung", () => {
    const referenz = songMitOnsets([1000, 2000, 3000]);
    expect(compareToReference(songMitOnsets([1200, 2200, 3200]), referenz).medianVersatzMs)
      .toBeCloseTo(200, 0);
    expect(compareToReference(songMitOnsets([800, 1800, 2800]), referenz).medianVersatzMs)
      .toBeCloseTo(-200, 0);
  });

  test("driftProfil bleibt bei konstantem Versatz flach", () => {
    const onsets = Array.from({ length: 100 }, (_, i) => i * 1000);
    const referenz = songMitOnsets(onsets);
    const konstant = songMitOnsets(onsets.map((o) => o + 200));
    const profil = compareToReference(konstant, referenz).driftProfil;

    expect(profil).toHaveLength(10);
    expect(Math.max(...profil) - Math.min(...profil)).toBeLessThan(50);
  });

  test("driftProfil zeigt lokales Verrutschen als Ausschlag", () => {
    const onsets = Array.from({ length: 100 }, (_, i) => i * 1000);
    const referenz = songMitOnsets(onsets);
    // Nur das letzte Zehntel verrutscht.
    const verrutscht = songMitOnsets(onsets.map((o, i) => (i >= 90 ? o + 3000 : o)));
    const profil = compareToReference(verrutscht, referenz).driftProfil;

    expect(profil[9]).toBeGreaterThan(2000);
    expect(profil[0]).toBeLessThan(50);
  });

  test("driftProfil hat auch ohne Paare zehn Eintraege ohne NaN", () => {
    const leer = { bpm: 60, gap: 0, syllables: [] };
    const profil = compareToReference(leer, leer).driftProfil;
    expect(profil).toHaveLength(10);
    expect(profil.every((w) => Number.isFinite(w))).toBe(true);
  });
});

// Fix-Task B: die Silbenfolgen von uns und Referenz stimmen in der Praxis
// nicht 1:1 ueberein (Silbentrennung ist eine menschliche Entscheidung) —
// die Paarung muss deshalb inhaltlich per LCS statt nach Position erfolgen.
describe("compareToReference - inhaltliche Paarung", () => {
  const songMitSilben = (silben: [string, number][]) => ({
    bpm: 60,
    gap: 0,
    syllables: silben.map(([syllable, onsetMs]) => ({ syllable, onsetMs, pitch: 0 })),
  });

  test("eine eingeschobene Silbe verschiebt die Paarung nicht", () => {
    // Positionale Paarung vergleicht nach dem Einschub verschiedene Woerter;
    // inhaltliche Paarung ueberspringt den Einschub und misst weiter richtig.
    const referenz = songMitSilben([
      ["Han", 0], ["de ", 500], ["hoch ", 1000], ["das ", 1500], ["ist ", 2000], ["gut ", 2500],
    ]);
    const unser = songMitSilben([
      ["Han", 0], ["de ", 500], ["extra ", 750], ["hoch ", 1000], ["das ", 1500], ["ist ", 2000], ["gut ", 2500],
    ]);
    const m = compareToReference(unser, referenz);
    expect(m.paare).toBe(6);
    expect(m.medianAbweichungMs).toBe(0);
    expect(m.anteilUnter50ms).toBe(1);
  });

  test("anteilGepaart macht fehlende Uebereinstimmung sichtbar", () => {
    const referenz = songMitSilben([
      ["eins ", 0], ["zwei ", 500], ["drei ", 1000], ["vier ", 1500],
    ]);
    const unser = songMitSilben([["eins ", 0], ["zwei ", 500]]);
    const m = compareToReference(unser, referenz);
    expect(m.paare).toBe(2);
    expect(m.anteilGepaart).toBeCloseTo(0.5, 5);
  });

  test("Paarung ignoriert Schreibweise, Satzzeichen und das Worttrenn-Leerzeichen", () => {
    const referenz = songMitSilben([["HOCH! ", 1000]]);
    const unser = songMitSilben([["hoch", 1040]]);
    const m = compareToReference(unser, referenz);
    expect(m.paare).toBe(1);
    expect(m.medianAbweichungMs).toBe(40);
  });

  test("wiederholte Silben werden monoton gepaart, nicht kreuzweise", () => {
    // la-la-la: jede Paarung muss in beiden Folgen vorwaerts laufen, sonst
    // wuerde ein spaetes la mit einem fruehen verglichen und die Abweichung
    // saehe riesig aus, obwohl alles stimmt.
    const referenz = songMitSilben([["la ", 0], ["la ", 500], ["la ", 1000]]);
    const unser = songMitSilben([["la ", 10], ["la ", 510], ["la ", 1010]]);
    const m = compareToReference(unser, referenz);
    expect(m.paare).toBe(3);
    expect(m.medianAbweichungMs).toBe(10);
    expect(m.p90AbweichungMs).toBe(10);
  });
});
