// src/desktop/renderer/components/editor/PianoRoll.tsx
// The note view: beats left to right, pitch bottom to top, syllables in a
// lane underneath. Drawn on a canvas - a few hundred DOM boxes that move on
// every frame of playback would be the slower and fiddlier choice. The
// pixels themselves are pianoRollDraw.ts; this is state and the mouse.
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { moveNote, shiftFrom, updateNote } from "../../../../core/edit/noteEdits.ts";
import type { EditNote, Track } from "../../../../core/edit/songTxt.ts";
import { geometrie, leseFarben, type Szene, type SungPoint, zeichne } from "./pianoRollDraw.ts";

const PITCH_PADDING = 3;
const EDGE_PX = 6;

type Drag = {
  mode: "move" | "resize";
  index: number;
  startX: number;
  startY: number;
  /** Shift held at the start: the move takes everything after along. */
  all: boolean;
};

export type PianoRollProps = {
  track: Track;
  /** The other voices of a duet. */
  ghosts: Track[];
  selected: number | null;
  overlaps: Set<number>;
  /** Playhead in beats; null without timing. */
  playheadBeat: number | null;
  /** Page along with the playhead (during playback). */
  follow: boolean;
  pxPerBeat: number;
  scrollBeat: number;
  sung: SungPoint[];
  suggestions: ReadonlyMap<number, number>;
  onScroll: (beat: number) => void;
  onZoom: (pxPerBeat: number, anchorBeat: number) => void;
  onSelect: (index: number | null) => void;
  onCommit: (track: Track) => void;
  onSeek: (beat: number) => void;
};

/**
 * The pitch range follows the committed notes only: rescaling under the
 * mouse while a note is dragged past the edge would be disorienting.
 * Duet voices and suggestions count, so nothing is drawn off the edge.
 */
const tonumfang = (
  track: Track,
  ghosts: Track[],
  suggestions: ReadonlyMap<number, number>,
): [number, number] => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const nimm = (p: number) => {
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  };
  for (const t of [track, ...ghosts]) for (const n of t.notes) nimm(n.pitch);
  for (const p of suggestions.values()) nimm(p);
  if (!Number.isFinite(lo)) return [-PITCH_PADDING, 12 + PITCH_PADDING];
  return [lo - PITCH_PADDING, hi + PITCH_PADDING];
};

export const PianoRoll: FC<PianoRollProps> = (p) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [groesse, setGroesse] = useState({ w: 800, h: 360 });
  const [vorschau, setVorschau] = useState<Track | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const propsRef = useRef(p);
  propsRef.current = p;
  const f = useMemo(leseFarben, []);

  const [minPitch, maxPitch] = useMemo(
    () => tonumfang(p.track, p.ghosts, p.suggestions),
    [p.track, p.ghosts, p.suggestions],
  );

  const szene: Szene = {
    w: groesse.w,
    h: groesse.h,
    scrollBeat: p.scrollBeat,
    pxPerBeat: p.pxPerBeat,
    minPitch,
    maxPitch,
    track: vorschau ?? p.track,
    ghosts: p.ghosts,
    selected: p.selected,
    overlaps: p.overlaps,
    playheadBeat: p.playheadBeat,
    sung: p.sung,
    suggestions: p.suggestions,
  };
  const { rollH, rowH, xVon, yVon } = geometrie(szene);
  const sichtBeats = groesse.w / p.pxPerBeat;

  // While playing, the view pages along with the playhead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per playhead move, reads the rest through propsRef
  useEffect(() => {
    const q = propsRef.current;
    if (!q.follow || q.playheadBeat === null) return;
    if (q.playheadBeat < q.scrollBeat || q.playheadBeat > q.scrollBeat + sichtBeats * 0.9) {
      q.onScroll(q.playheadBeat - sichtBeats * 0.1);
    }
  }, [p.playheadBeat, sichtBeats]);

  // A note selected by keyboard may sit outside the view.
  const auswahl = p.selected === null ? undefined : p.track.notes[p.selected];
  useEffect(() => {
    const q = propsRef.current;
    if (!auswahl) return;
    const ende = auswahl.beat + auswahl.length;
    if (auswahl.beat < q.scrollBeat || ende > q.scrollBeat + sichtBeats) {
      q.onScroll(auswahl.beat - sichtBeats * 0.25);
    }
  }, [auswahl, sichtBeats]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setGroesse({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Redrawn on every render: the scene object is new each time, and a
  // render is exactly when something visible may have changed.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(szene.w * dpr);
    canvas.height = Math.round(szene.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    zeichne(ctx, szene, f);
  });

  const trefferAn = (x: number, y: number): { index: number; rand: boolean } | null => {
    const notes = p.track.notes;
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const n = notes[i] as EditNote;
      const nx = xVon(n.beat);
      const nw = Math.max(2, n.length * p.pxPerBeat);
      const ny = yVon(n.pitch);
      const imX = x >= nx - 2 && x <= nx + nw + 2;
      const imY = y >= ny - 2 && y <= ny + rowH + 2;
      if (imX && imY) {
        return { index: i, rand: x >= nx + nw - EDGE_PX && nw > EDGE_PX * 2 };
      }
    }
    return null;
  };

  const lokal = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    // The canvas takes no focus, so a half-typed field in the panel would
    // keep it and be thrown away when the selection changes. Blurring
    // commits it first.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const { x, y } = lokal(e);
    const treffer = y < rollH ? trefferAn(x, y) : null;
    if (!treffer) {
      p.onSeek(Math.max(0, p.scrollBeat + x / p.pxPerBeat));
      return;
    }
    p.onSelect(treffer.index);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: treffer.rand ? "resize" : "move",
      index: treffer.index,
      startX: x,
      startY: y,
      all: e.shiftKey,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = lokal(e);
    const drag = dragRef.current;
    if (!drag) {
      const t = y < rollH ? trefferAn(x, y) : null;
      e.currentTarget.style.cursor = t ? (t.rand ? "ew-resize" : "grab") : "text";
      return;
    }
    const dBeat = Math.round((x - drag.startX) / p.pxPerBeat);
    const original = p.track.notes[drag.index] as EditNote;
    if (drag.mode === "resize") {
      setVorschau(updateNote(p.track, drag.index, { length: original.length + dBeat }));
      return;
    }
    const dPitch = Math.round((drag.startY - y) / rowH);
    const verschoben = drag.all
      ? shiftFrom(p.track, drag.index, dBeat)
      : moveNote(p.track, drag.index, dBeat);
    setVorschau(
      dPitch === 0
        ? verschoben
        : updateNote(verschoben, drag.index, { pitch: original.pitch + dPitch }),
    );
  };

  const onPointerUp = () => {
    const ergebnis = vorschau;
    dragRef.current = null;
    setVorschau(null);
    if (ergebnis && ergebnis !== p.track) p.onCommit(ergebnis);
  };

  // The system took the pointer away (a dialog, a lost capture): not a drop.
  const onPointerCancel = () => {
    dragRef.current = null;
    setVorschau(null);
  };

  // Non-passive: Ctrl + wheel must not also zoom the whole window.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const q = propsRef.current;
      const r = canvas.getBoundingClientRect();
      const anker = q.scrollBeat + (e.clientX - r.left) / q.pxPerBeat;
      if (e.ctrlKey) {
        q.onZoom(q.pxPerBeat * (e.deltaY < 0 ? 1.25 : 0.8), anker);
        return;
      }
      const delta = (e.deltaX !== 0 ? e.deltaX : e.deltaY) / q.pxPerBeat;
      q.onScroll(q.scrollBeat + delta);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={boxRef} className="piano-roll">
      <canvas
        ref={canvasRef}
        style={{ width: groesse.w, height: groesse.h, display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </div>
  );
};

export default PianoRoll;
