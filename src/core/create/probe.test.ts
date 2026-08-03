import { describe, expect, it } from "bun:test";
import { dauerAusFfmpeg, dauerAusYtDlp } from "./probe.ts";

// Real tool output, not invented.
const YTDLP = "213.0\n";
const FFMPEG = `ffmpeg version n7.1 Copyright (c) 2000-2024 the FFmpeg developers
Input #0, mp3, from 'song.mp3':
  Metadata:
    title           : Rock Me Amadeus
  Duration: 00:03:33.42, start: 0.025057, bitrate: 320 kb/s
At least one output file must be specified
`;

describe("dauerAusYtDlp", () => {
  it("liest die nackte Sekundenzahl", () => {
    expect(dauerAusYtDlp(YTDLP)).toBe(213);
  });

  it("nimmt die erste Zeile bei mehreren", () => {
    expect(dauerAusYtDlp("213.0\n42.0\n")).toBe(213);
  });

  it("liefert null bei NA", () => {
    expect(dauerAusYtDlp("NA\n")).toBeNull();
  });

  it("liefert null bei leerer Ausgabe", () => {
    expect(dauerAusYtDlp("")).toBeNull();
  });
});

describe("dauerAusFfmpeg", () => {
  it("liest Duration aus dem Banner", () => {
    expect(dauerAusFfmpeg(FFMPEG)).toBeCloseTo(213.42, 2);
  });

  it("liefert null ohne Duration", () => {
    expect(
      dauerAusFfmpeg("ffmpeg version n7.1\nInvalid data found\n"),
    ).toBeNull();
  });

  it("liefert null bei Duration N/A", () => {
    expect(dauerAusFfmpeg("  Duration: N/A, bitrate: N/A\n")).toBeNull();
  });
});
