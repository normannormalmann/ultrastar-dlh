// src/desktop/renderer/components/editor/pitchDetect.ts
// Pitch of one short block of microphone samples, after the YIN method
// (de Cheveigné & Kawahara, 2002). Small, dependency-free and accurate
// enough for a singing voice; a neural model would be overkill for "which
// semitone did you sing".

/** Range of a singing voice, with headroom: a low bass to a high soprano. */
const MIN_HZ = 65;
const MAX_HZ = 1100;
/** YIN's absolute threshold; lower is stricter about what counts as a tone. */
const YIN_THRESHOLD = 0.15;
/** Below this RMS the block is treated as silence, not as noise to analyse. */
const SILENCE_RMS = 0.01;

export type PitchResult = {
  hz: number;
  /** 1 - the YIN dip: near 1 is a clean tone, near 0 is noise. */
  clarity: number;
};

const rms = (s: Float32Array): number => {
  let summe = 0;
  for (let i = 0; i < s.length; i += 1) summe += (s[i] as number) ** 2;
  return Math.sqrt(summe / s.length);
};

export const detectPitch = (samples: Float32Array, sampleRate: number): PitchResult | null => {
  if (rms(samples) < SILENCE_RMS) return null;
  const tauMin = Math.floor(sampleRate / MAX_HZ);
  const tauMax = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(samples.length / 2));
  if (tauMax <= tauMin) return null;
  const fenster = samples.length - tauMax;

  // Difference function, then its cumulative mean normalisation.
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let summe = 0;
    for (let i = 0; i < fenster; i += 1) {
      const diff = (samples[i] as number) - (samples[i + tau] as number);
      summe += diff * diff;
    }
    d[tau] = summe;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let laufend = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    laufend += d[tau] as number;
    cmnd[tau] = laufend === 0 ? 1 : ((d[tau] as number) * tau) / laufend;
  }

  // The first dip under the threshold, followed down to its bottom.
  let tau = tauMin;
  while (tau <= tauMax && (cmnd[tau] as number) >= YIN_THRESHOLD) tau += 1;
  if (tau > tauMax) return null;
  while (tau + 1 <= tauMax && (cmnd[tau + 1] as number) < (cmnd[tau] as number)) tau += 1;

  // Parabolic interpolation between the neighbours for a sub-sample period.
  const a = cmnd[tau - 1] ?? (cmnd[tau] as number);
  const b = cmnd[tau] as number;
  const c = cmnd[tau + 1] ?? b;
  const nenner = a - 2 * b + c;
  const genau = nenner === 0 ? tau : tau + (a - c) / (2 * nenner);
  return { hz: sampleRate / genau, clarity: 1 - b };
};

/** MIDI note number as a float: 69 is A4 = 440 Hz. */
export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
