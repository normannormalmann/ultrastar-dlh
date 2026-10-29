// src/desktop/renderer/components/editor/pianoRollDraw.ts
// Drawing for the piano roll, layer by layer: background, doubt bands, the
// other duet voice, notes, a sung take, the playhead. Kept apart from the
// component so that one is about state and the mouse, this one about pixels.
import type { EditNote, Track } from "../../../../core/edit/songTxt.ts";

export const LYRIC_LANE = 24;

export type Farben = {
  bg: string;
  row: string;
  grid: string;
  text: string;
  note: string;
  golden: string;
  rap: string;
  selected: string;
  bad: string;
  playhead: string;
  unsure: string;
  sung: string;
};

export const leseFarben = (): Farben => {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--mantle", "#181825"),
    row: v("--base", "#1e1e2e"),
    grid: v("--overlay", "#6c7086"),
    text: v("--text", "#cdd6f4"),
    note: v("--mauve", "#cba6f7"),
    golden: v("--yellow", "#f9e2af"),
    rap: v("--cyan", "#89dceb"),
    selected: v("--neon", "#e879ff"),
    bad: v("--red", "#f38ba8"),
    playhead: v("--green", "#a6e3a1"),
    unsure: v("--peach", "#fab387"),
    sung: v("--green", "#a6e3a1"),
  };
};

/** A point of a sung take, already in beats and UltraStar pitch. */
export type SungPoint = { beat: number; pitch: number };

export type Szene = {
  w: number;
  h: number;
  scrollBeat: number;
  pxPerBeat: number;
  minPitch: number;
  maxPitch: number;
  track: Track;
  /** The other voices of a duet, drawn faintly for orientation. */
  ghosts: Track[];
  selected: number | null;
  overlaps: Set<number>;
  playheadBeat: number | null;
  sung: SungPoint[];
  /** Note index -> suggested pitch from a sung take. */
  suggestions: ReadonlyMap<number, number>;
};

export type Geometrie = {
  rollH: number;
  rowH: number;
  xVon: (beat: number) => number;
  yVon: (pitch: number) => number;
};

export const geometrie = (s: Szene): Geometrie => {
  const rollH = s.h - LYRIC_LANE;
  const rowH = rollH / (s.maxPitch - s.minPitch + 1);
  return {
    rollH,
    rowH,
    xVon: (beat) => (beat - s.scrollBeat) * s.pxPerBeat,
    yVon: (pitch) => (s.maxPitch - pitch) * rowH,
  };
};

const notenFarbe = (n: EditNote, f: Farben): string => {
  if (n.type === "*" || n.type === "G") return f.golden;
  if (n.type === "R") return f.rap;
  return f.note;
};

const sichtbar = (x: number, w: number, s: Szene): boolean => x + w >= 0 && x <= s.w;

const hintergrund = (ctx: CanvasRenderingContext2D, s: Szene, g: Geometrie, f: Farben) => {
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, s.w, s.h);
  for (let pitch = s.minPitch; pitch <= s.maxPitch; pitch += 1) {
    if (pitch % 2 === 0) {
      ctx.fillStyle = f.row;
      ctx.fillRect(0, g.yVon(pitch), s.w, g.rowH);
    }
    if (((pitch % 12) + 12) % 12 === 0) {
      ctx.fillStyle = f.grid;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(0, g.yVon(pitch) + g.rowH - 1, s.w, 1);
      ctx.globalAlpha = 1;
    }
  }
  // Beat grid: every 4 beats, every 16 a little stronger.
  if (s.pxPerBeat * 4 < 6) return;
  const letzter = s.scrollBeat + s.w / s.pxPerBeat;
  for (let b = Math.floor(s.scrollBeat / 4) * 4; b <= letzter; b += 4) {
    ctx.globalAlpha = b % 16 === 0 ? 0.35 : 0.15;
    ctx.fillStyle = f.grid;
    ctx.fillRect(Math.round(g.xVon(b)), 0, 1, g.rollH);
  }
  ctx.globalAlpha = 1;
};

/**
 * Full-height bands behind doubted stretches, one band per run so the gaps
 * between its notes are covered too - the toolbar counts runs, the picture
 * should show the same number. Guessed timing is drawn stronger than weak.
 */
const zweifel = (ctx: CanvasRenderingContext2D, s: Szene, g: Geometrie, f: Farben) => {
  ctx.fillStyle = f.unsure;
  const notes = s.track.notes;
  let i = 0;
  while (i < notes.length) {
    const start = notes[i] as EditNote;
    if (!start.unsure) {
      i += 1;
      continue;
    }
    let ende = start;
    while (i + 1 < notes.length && notes[i + 1]?.unsure === start.unsure) {
      i += 1;
      ende = notes[i] as EditNote;
    }
    const x = g.xVon(start.beat);
    const w = Math.max(2, (ende.beat + ende.length - start.beat) * s.pxPerBeat);
    if (sichtbar(x, w, s)) {
      ctx.globalAlpha = start.unsure === "interpolated" ? 0.2 : 0.1;
      ctx.fillRect(x, 0, w, g.rollH);
    }
    i += 1;
  }
  ctx.globalAlpha = 1;
};

const geister = (ctx: CanvasRenderingContext2D, s: Szene, g: Geometrie, f: Farben) => {
  ctx.fillStyle = f.grid;
  ctx.globalAlpha = 0.3;
  for (const spur of s.ghosts) {
    for (const n of spur.notes) {
      const x = g.xVon(n.beat);
      const w = Math.max(2, n.length * s.pxPerBeat - 1);
      if (sichtbar(x, w, s)) ctx.fillRect(x, g.yVon(n.pitch) + 1, w, Math.max(3, g.rowH - 2));
    }
  }
  ctx.globalAlpha = 1;
};

const noten = (ctx: CanvasRenderingContext2D, s: Szene, g: Geometrie, f: Farben) => {
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  s.track.notes.forEach((n, i) => {
    const x = g.xVon(n.beat);
    const w = Math.max(2, n.length * s.pxPerBeat - 1);
    if (!sichtbar(x, w, s)) return;
    const y = g.yVon(n.pitch) + 1;
    const h = Math.max(3, g.rowH - 2);
    const gewaehlt = i === s.selected;
    ctx.fillStyle = gewaehlt ? f.selected : notenFarbe(n, f);
    ctx.globalAlpha = n.type === "F" && !gewaehlt ? 0.35 : 0.9;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    if (gewaehlt || s.overlaps.has(i)) {
      ctx.strokeStyle = gewaehlt ? f.text : f.bad;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    }

    ctx.fillStyle = gewaehlt ? f.selected : f.text;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, g.rollH, Math.max(w, 4) + 6, LYRIC_LANE);
    ctx.clip();
    ctx.fillText(n.syllable, x, g.rollH + LYRIC_LANE / 2);
    ctx.restore();

    if (n.breakAfter) {
      const bx = Math.round(g.xVon(n.breakAfter.beat));
      ctx.fillStyle = f.grid;
      ctx.globalAlpha = 0.8;
      for (let yy = 0; yy < s.h; yy += 8) ctx.fillRect(bx, yy, 1, 4);
      ctx.globalAlpha = 1;
    }
  });
};

/** The sung line as dots, the suggested pitches as dashed outlines. */
const gesang = (ctx: CanvasRenderingContext2D, s: Szene, g: Geometrie, f: Farben) => {
  ctx.fillStyle = f.sung;
  for (const p of s.sung) {
    const x = g.xVon(p.beat);
    if (x < -2 || x > s.w + 2) continue;
    ctx.fillRect(x - 1, g.yVon(p.pitch) + g.rowH / 2 - 1, 3, 3);
  }
  ctx.strokeStyle = f.sung;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  for (const [i, pitch] of s.suggestions) {
    const n = s.track.notes[i];
    if (!n) continue;
    const x = g.xVon(n.beat);
    const w = Math.max(2, n.length * s.pxPerBeat - 1);
    if (sichtbar(x, w, s)) ctx.strokeRect(x, g.yVon(pitch) + 1, w, Math.max(3, g.rowH - 2));
  }
  ctx.setLineDash([]);
};

export const zeichne = (ctx: CanvasRenderingContext2D, s: Szene, f: Farben): void => {
  const g = geometrie(s);
  hintergrund(ctx, s, g, f);
  zweifel(ctx, s, g, f);
  geister(ctx, s, g, f);
  noten(ctx, s, g, f);
  gesang(ctx, s, g, f);
  if (s.playheadBeat !== null) {
    ctx.fillStyle = f.playhead;
    ctx.fillRect(Math.round(g.xVon(s.playheadBeat)), 0, 2, s.h);
  }
};
