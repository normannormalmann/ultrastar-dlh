// src/desktop/renderer/components/editor/singAlong.test.ts
import { describe, expect, it } from "bun:test";
import type { NoteSeq } from "../../../../core/edit/songTxt.ts";
import { detectPitch, hzToMidi } from "./pitchDetect.ts";
import { type SungFrame, suggestPitches } from "./singAlong.ts";

const RATE = 48000;

const sinus = (hz: number, n = 2048, amplitude = 0.5): Float32Array => {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i += 1) s[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return s;
};

/** A voice-like tone: fundamental plus decaying overtones. */
const stimme = (hz: number): Float32Array => {
  const s = new Float32Array(2048);
  for (let k = 1; k <= 5; k += 1) {
    const teil = sinus(hz * k, 2048, 0.4 / k);
    for (let i = 0; i < s.length; i += 1) s[i] = (s[i] as number) + (teil[i] as number);
  }
  return s;
};

describe("detectPitch", () => {
  it("erkennt reine Sinustoene auf wenige Cent genau", () => {
    for (const hz of [110, 220, 261.63, 440, 880]) {
      const r = detectPitch(sinus(hz), RATE);
      expect(r).not.toBeNull();
      expect(Math.abs(hzToMidi(r?.hz ?? 0) - hzToMidi(hz))).toBeLessThan(0.1);
    }
  });

  it("nimmt bei Obertoenen den Grundton, nicht die Oktave", () => {
    const r = detectPitch(stimme(196), RATE);
    expect(Math.round(hzToMidi(r?.hz ?? 0))).toBe(55); // G3
  });

  it("meldet Stille und Rauschen als kein Ton", () => {
    expect(detectPitch(new Float32Array(2048), RATE)).toBeNull();
    let x = 1;
    const rauschen = new Float32Array(2048).map(() => {
      x = (x * 16807) % 2147483647;
      return (x / 2147483647 - 0.5) * 0.6;
    });
    expect(detectPitch(rauschen, RATE)).toBeNull();
  });
});

describe("suggestPitches", () => {
  // 300 BPM: 50 ms per beat, GAP 0. Three notes of 8 beats = 400 ms each.
  const timing = { bpm: 300, gap: 0 };
  const spur: NoteSeq = {
    notes: [
      { type: ":", beat: 0, length: 8, pitch: 0, syllable: "a" },
      { type: ":", beat: 8, length: 8, pitch: 4, syllable: "b" },
      { type: "F", beat: 16, length: 8, pitch: 0, syllable: "c" },
    ],
  };

  /** 60 readings per second at a steady MIDI note for a stretch of time. */
  const gesungen = (vonMs: number, bisMs: number, midi: number): SungFrame[] => {
    const frames: SungFrame[] = [];
    for (let ms = vonMs; ms < bisMs; ms += 1000 / 60) frames.push({ ms, midi });
    return frames;
  };

  it("schlaegt den gesungenen Ton vor, wo er abweicht", () => {
    const frames = [...gesungen(0, 400, 62), ...gesungen(400, 800, 64)];
    const r = suggestPitches(spur, 0, 2, timing, frames);
    expect(r.judged).toBe(2);
    expect([...r.pitches]).toEqual([[0, 2]]); // note b was right already
  });

  it("gleicht eine tiefer gesungene Oktave aus", () => {
    const frames = [...gesungen(0, 400, 48 + 1), ...gesungen(400, 800, 52)];
    const r = suggestPitches(spur, 0, 1, timing, frames);
    expect(r.octaveShift).toBe(-1);
    expect([...r.pitches]).toEqual([[0, 1]]);
  });

  it("laesst Noten ohne genug Gesang und Freestyle-Noten aus", () => {
    const frames = [...gesungen(300, 400, 70), ...gesungen(800, 1200, 70)];
    const r = suggestPitches(spur, 0, 2, timing, frames);
    expect(r.judged).toBe(0);
    expect(r.pitches.size).toBe(0);
  });

  it("nimmt den Median, nicht einen Ausreisser", () => {
    const frames = gesungen(0, 400, 62).map((f, i) => (i % 7 === 0 ? { ...f, midi: 74 } : f));
    expect(suggestPitches(spur, 0, 0, timing, frames).pitches.get(0)).toBe(2);
  });
});
