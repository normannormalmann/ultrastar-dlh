import { describe, expect, it } from "bun:test";
import { BEATS_PER_BPM_UNIT, beatToMs, msToBeat } from "./format.ts";

describe("beatToMs / msToBeat", () => {
  it("verankert Beat 0 auf dem GAP", () => {
    expect(beatToMs(0, 300, 1200)).toBe(1200);
  });

  it("ist invertierbar", () => {
    for (const beat of [0, 1, 7, 64, 999]) {
      expect(msToBeat(beatToMs(beat, 294.5, 800), 294.5, 800)).toBeCloseTo(beat, 6);
    }
  });

  it("waechst streng monoton mit dem Beat", () => {
    expect(beatToMs(10, 300, 0)).toBeGreaterThan(beatToMs(9, 300, 0));
  });

  it("halbiert die Beatdauer bei doppeltem BPM", () => {
    const langsam = beatToMs(8, 150, 0);
    const schnell = beatToMs(8, 300, 0);
    expect(schnell).toBeCloseTo(langsam / 2, 6);
  });

  it("hat einen dokumentierten, positiven ganzzahligen Faktor", () => {
    expect(Number.isInteger(BEATS_PER_BPM_UNIT)).toBe(true);
    expect(BEATS_PER_BPM_UNIT).toBeGreaterThan(0);
  });
});
