// scripts/compare-runs.test.ts
import { describe, expect, it } from "bun:test";
import type { Metrics } from "../src/core/create/evaluate.ts";
import {
  formatiereBericht,
  type Lauf,
  verketteBloecke,
  vergleicheLaeufe,
  type Zeile,
} from "./compare-runs.ts";

const basisMetrik: Metrics = {
  paare: 100,
  medianAbweichungMs: 40,
  p90AbweichungMs: 200,
  anteilUnter50ms: 0.3,
  anteilUnter100ms: 0.5,
  notenzahlDifferenz: -3,
  medianPitchOffset: 0,
  anteilPitchExakt: 0.4,
  medianVersatzMs: 30,
  driftProfil: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  anteilGepaart: 0.9,
  anteilUnter50msKalibriert: 0.37,
  anteilUnter100msKalibriert: 0.6,
};

/** Eine Ergebniszeile mit erfundenem Song; nur die genannten Metriken weichen ab. */
const zeile = (name: string, m: Partial<Metrics> = {}, sekunden = 100): Zeile => ({
  name,
  songDir: `X:/korpus/${name}`,
  lrc: false,
  sekunden,
  interpolationsAnteil: 0.04,
  m: { ...basisMetrik, ...m },
});

const lauf = (songs: Zeile[], modelle: Record<string, string> = {}): Lauf => ({
  modelle,
  songs,
  fehlschlaege: [],
});

const optionen = {
  ausschluss: [] as string[],
  primaer: "anteilPitchExakt" as const,
  schwellePunkte: 5,
  seed: 1,
  ziehungen: 2000,
};

describe("vergleicheLaeufe: Paarung", () => {
  it("paart Songs ueber den Namen und rechnet die Differenz der Primaermetrik in Punkten", () => {
    const basis = lauf([zeile("A", { anteilPitchExakt: 0.3 }), zeile("B", { anteilPitchExakt: 0.4 })]);
    // Andere Reihenfolge im Arm: die Paarung darf nicht positional sein.
    const arm = lauf([zeile("B", { anteilPitchExakt: 0.5 }), zeile("A", { anteilPitchExakt: 0.4 })]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.songs).toBe(2);
    expect(ergebnis.differenzen.map((d) => [d.name, d.punkte])).toEqual([
      ["A", 10],
      ["B", 10],
    ]);
    expect(ergebnis.mittelPunkte).toBeCloseTo(10, 6);
  });

  it("laesst Songs der Ausschlussliste in beiden Armen weg", () => {
    const basis = lauf([zeile("A", { anteilPitchExakt: 0.3 }), zeile("Raus", { anteilPitchExakt: 0.0 })]);
    const arm = lauf([zeile("A", { anteilPitchExakt: 0.4 }), zeile("Raus", { anteilPitchExakt: 0.9 })]);

    const ergebnis = vergleicheLaeufe(basis, arm, { ...optionen, ausschluss: ["Raus"] });

    expect(ergebnis.songs).toBe(1);
    expect(ergebnis.ausgeschlossen).toEqual(["Raus"]);
    expect(ergebnis.mittelPunkte).toBeCloseTo(10, 6);
  });

  it("meldet Songs, die nur in einem Arm liegen, und zaehlt sie nicht", () => {
    const basis = lauf([zeile("A"), zeile("NurBasis")]);
    const arm = lauf([zeile("A"), zeile("NurArm")]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.songs).toBe(1);
    expect(ergebnis.ungepaart).toEqual({ basis: ["NurBasis"], arm: ["NurArm"] });
  });
});

describe("vergleicheLaeufe: Gueltigkeitswaechter", () => {
  it("erklaert den Lauf fuer ungueltig, wenn eine Zeitmetrik je Song nicht exakt gleich bleibt", () => {
    const basis = lauf([zeile("A"), zeile("B", { anteilUnter50ms: 0.3 })]);
    const arm = lauf([zeile("A"), zeile("B", { anteilUnter50ms: 0.31 })]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.entscheidung).toBe("ungueltig");
    expect(ergebnis.waechterVerletzungen).toEqual([
      { name: "B", metrik: "anteilUnter50ms", basis: 0.3, arm: 0.31 },
    ]);
  });

  it("prueft alle vier Waechter: <50 ms, <100 ms, gepaart, Notenzahl", () => {
    const basis = lauf([
      zeile("A", { anteilUnter100ms: 0.5 }),
      zeile("B", { anteilGepaart: 0.9 }),
      zeile("C", { notenzahlDifferenz: -3 }),
    ]);
    const arm = lauf([
      zeile("A", { anteilUnter100ms: 0.51 }),
      zeile("B", { anteilGepaart: 0.91 }),
      zeile("C", { notenzahlDifferenz: -2 }),
    ]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.waechterVerletzungen.map((v) => v.metrik)).toEqual([
      "anteilUnter100ms",
      "anteilGepaart",
      "notenzahlDifferenz",
    ]);
  });

  it("nennt ein abweichendes LRC-Flag als eigenen Waechter: andere Anker, anderes Alignment", () => {
    // Gemessen am 29.10.2026: LRCLIB antwortete im Basislauf fuer einen Song
    // nicht, im Arm dann doch. Die Zeitmetriken wanderten mit, aber die
    // Ursache stand nicht im Bericht.
    const basis = lauf([{ ...zeile("A"), lrc: false }]);
    const arm = lauf([{ ...zeile("A"), lrc: true }]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.entscheidung).toBe("ungueltig");
    expect(ergebnis.waechterVerletzungen).toEqual([{ name: "A", metrik: "lrc", basis: 0, arm: 1 }]);
    expect(formatiereBericht(ergebnis, basis, arm, optionen)).toContain("lrc 0 -> 1");
  });

  it("bleibt gueltig, wenn die Waechter gleich sind und nur die Tonhoehe sich aendert", () => {
    const basis = lauf([zeile("A", { anteilPitchExakt: 0.3 })]);
    const arm = lauf([zeile("A", { anteilPitchExakt: 0.5, medianPitchOffset: 1 })]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.waechterVerletzungen).toEqual([]);
    expect(ergebnis.entscheidung).not.toBe("ungueltig");
  });
});

describe("vergleicheLaeufe: Entscheidung", () => {
  const paar = (name: string, basisAnteil: number, armAnteil: number) =>
    [zeile(name, { anteilPitchExakt: basisAnteil }), zeile(name, { anteilPitchExakt: armAnteil })] as const;

  const laeufe = (paare: (readonly [Zeile, Zeile])[]): [Lauf, Lauf] => [
    lauf(paare.map((p) => p[0])),
    lauf(paare.map((p) => p[1])),
  ];

  it("uebernimmt, wenn das Mittel die Schwelle erreicht und das KI die 0 ausschliesst", () => {
    const [basis, arm] = laeufe(
      Array.from({ length: 10 }, (_, i) => paar(`S${i}`, 0.4, 0.48)),
    );

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.mittelPunkte).toBeCloseTo(8, 6);
    expect(ergebnis.ki[0]).toBeGreaterThan(0);
    expect(ergebnis.entscheidung).toBe("uebernehmen");
  });

  it("verwirft, wenn das Mittel unter der Schwelle liegt, auch bei sicherem Effekt", () => {
    const [basis, arm] = laeufe(
      Array.from({ length: 10 }, (_, i) => paar(`S${i}`, 0.4, 0.43)),
    );

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.mittelPunkte).toBeCloseTo(3, 6);
    expect(ergebnis.ki[0]).toBeGreaterThan(0);
    expect(ergebnis.entscheidung).toBe("verworfen");
  });

  it("verwirft, wenn das Mittel ueber der Schwelle liegt, das KI aber die 0 enthaelt", () => {
    // Ein Ausreisser traegt das Mittel ueber die Schwelle (+6), die anderen
    // vier Songs werden schlechter. Bootstrap-Ziehungen ohne den Ausreisser
    // liegen unter 0, also enthaelt das KI die 0.
    const [basis, arm] = laeufe([
      paar("Ausreisser", 0.4, 0.8),
      paar("B", 0.4, 0.38),
      paar("C", 0.4, 0.38),
      paar("D", 0.4, 0.38),
      paar("E", 0.4, 0.36),
    ]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.mittelPunkte).toBeCloseTo(6, 6);
    expect(ergebnis.ki[0]).toBeLessThanOrEqual(0);
    expect(ergebnis.entscheidung).toBe("verworfen");
  });

  it("liefert bei gleichem Seed dasselbe KI und bei anderem Seed ein anderes", () => {
    const [basis, arm] = laeufe(
      Array.from({ length: 12 }, (_, i) => paar(`S${i}`, 0.4, 0.4 + (i % 3) * 0.05)),
    );

    const a = vergleicheLaeufe(basis, arm, { ...optionen, seed: 7 });
    const b = vergleicheLaeufe(basis, arm, { ...optionen, seed: 7 });
    const c = vergleicheLaeufe(basis, arm, { ...optionen, seed: 8 });

    expect(a.ki).toEqual(b.ki);
    expect(a.ki).not.toEqual(c.ki);
    expect(a.ki[0]).toBeLessThanOrEqual(a.mittelPunkte);
    expect(a.ki[1]).toBeGreaterThanOrEqual(a.mittelPunkte);
  });

  it("ist ungueltig, bevor die Schwelle ueberhaupt geprueft wird", () => {
    const basis = lauf(Array.from({ length: 10 }, (_, i) => zeile(`S${i}`, { anteilPitchExakt: 0.4 })));
    const arm = lauf(
      Array.from({ length: 10 }, (_, i) =>
        zeile(`S${i}`, { anteilPitchExakt: 0.5, anteilGepaart: i === 3 ? 0.91 : 0.9 }),
      ),
    );

    expect(vergleicheLaeufe(basis, arm, optionen).entscheidung).toBe("ungueltig");
  });
});

describe("vergleicheLaeufe: Sekundaeres und Hinweise", () => {
  it("meldet Laufzeit je Song und die Streuung des Pitch-Versatzes je Arm", () => {
    const basis = lauf([
      zeile("A", { medianPitchOffset: 0 }, 100),
      zeile("B", { medianPitchOffset: 0 }, 300),
    ]);
    const arm = lauf([
      zeile("A", { medianPitchOffset: -2 }, 50),
      zeile("B", { medianPitchOffset: 2 }, 70),
    ]);

    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    expect(ergebnis.sekundaer.sekundenJeSong).toEqual({ basis: 200, arm: 60 });
    // Stichproben-Standardabweichung: Basis 0, Arm sqrt(((−2)² + 2²) / 1) = 2.83
    expect(ergebnis.sekundaer.pitchOffsetStreuung.basis).toBeCloseTo(0, 6);
    expect(ergebnis.sekundaer.pitchOffsetStreuung.arm).toBeCloseTo(Math.sqrt(8), 6);
  });

  it("weist auf Songs mit Editions-Versatz ueber 2 s hin, die nicht ausgeschlossen sind", () => {
    const basis = lauf([
      zeile("Ok", { medianVersatzMs: 30 }),
      zeile("FalscheEdition", { medianVersatzMs: -2300 }),
      zeile("Raus", { medianVersatzMs: 5000 }),
    ]);
    const arm = lauf(basis.songs.map((z) => ({ ...z })));

    const ergebnis = vergleicheLaeufe(basis, arm, { ...optionen, ausschluss: ["Raus"] });

    expect(ergebnis.editionsHinweise).toEqual([{ name: "FalscheEdition", medianVersatzMs: -2300 }]);
  });
});

describe("verketteBloecke", () => {
  it("haengt die Songs mehrerer Bloecke aneinander und behaelt die Fehlschlaege", () => {
    const block1 = { ...lauf([zeile("A")]), fehlschlaege: [{ name: "F", songDir: "x", fehler: "kein Audio" }] };
    const block2 = lauf([zeile("B"), zeile("C")]);

    const ganz = verketteBloecke([block1, block2]);

    expect(ganz.songs.map((z) => z.name)).toEqual(["A", "B", "C"]);
    expect(ganz.fehlschlaege.map((f) => f.name)).toEqual(["F"]);
  });

  it("lehnt Bloecke ab, die denselben Song zweimal enthalten", () => {
    expect(() => verketteBloecke([lauf([zeile("A")]), lauf([zeile("A")])])).toThrow(/A/);
  });

  it("lehnt Bloecke ab, die mit verschiedenen Modellen gemessen wurden", () => {
    const b1 = lauf([zeile("A")], { pitch: "swift-f0" });
    const b2 = lauf([zeile("B")], { pitch: "torchcrepe-full" });
    expect(() => verketteBloecke([b1, b2])).toThrow(/pitch/);
  });
});

describe("formatiereBericht", () => {
  it("nennt Entscheidung, Mittel, KI und die Waechter-Verletzungen im Klartext", () => {
    const basis = lauf([zeile("A", { anteilPitchExakt: 0.4 })], { pitch: "swift-f0" });
    const arm = lauf([zeile("A", { anteilPitchExakt: 0.5, anteilUnter50ms: 0.31 })], { pitch: "torchcrepe-full" });
    const ergebnis = vergleicheLaeufe(basis, arm, optionen);

    const text = formatiereBericht(ergebnis, basis, arm, optionen);

    expect(text).toContain("UNGUELTIG");
    expect(text).toContain("anteilUnter50ms");
    expect(text).toContain("swift-f0");
    expect(text).toContain("torchcrepe-full");
    expect(text).toMatch(/\+10[.,]0/);
  });
});
