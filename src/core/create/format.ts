/**
 * Beats pro BPM-Einheit im UltraStar-Format.
 * ACHTUNG: Dieser Wert ist gemessen, nicht aus Doku abgeleitet — siehe
 * scripts/measure-beat-convention.ts und den Nachtrag im Design-Dokument.
 * Reproduziert am 2026-07-26 über 40 Songs der lokalen Bibliothek (J:/Ultrastar):
 * Median Songende/Audiodauer 0,919, davon 36/40 im Fenster 0,6-1,05.
 */
export const BEATS_PER_BPM_UNIT = 4;

/** Millisekunden pro Beat bei gegebenem BPM. */
const msPerBeat = (bpm: number): number => 60_000 / (bpm * BEATS_PER_BPM_UNIT);

/** Beatposition -> absolute Zeit in ms, gemessen ab Songanfang. */
export const beatToMs = (beat: number, bpm: number, gapMs: number): number =>
  gapMs + beat * msPerBeat(bpm);

/** Absolute Zeit in ms -> Beatposition. Umkehrung von beatToMs. */
export const msToBeat = (ms: number, bpm: number, gapMs: number): number =>
  (ms - gapMs) / msPerBeat(bpm);
