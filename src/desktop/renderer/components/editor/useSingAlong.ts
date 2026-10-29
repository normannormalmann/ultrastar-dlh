// src/desktop/renderer/components/editor/useSingAlong.ts
// "Sing it in": plays a stretch of the song, listens to the microphone at
// the same time and turns what was sung into pitch suggestions. The take is
// kept until it is applied or thrown away, so the piano roll can show the
// sung line next to the notes before anything changes.
import { useCallback, useEffect, useRef, useState } from "react";
import { beatToMs, type NoteSeq, type Timing } from "../../../../core/edit/songTxt.ts";
import { detectPitch, hzToMidi } from "./pitchDetect.ts";
import { type SingSuggestion, type SungFrame, suggestPitches } from "./singAlong.ts";
import type { Playback } from "./usePlayback.ts";

/** Time to get ready before the first note of the stretch. */
const LEAD_IN_MS = 1500;
const TAIL_MS = 400;
/** A reading below this clarity is noise, not a sung tone. */
const MIN_CLARITY = 0.8;
const ANALYSER_SIZE = 2048;
const START_TIMEOUT_MS = 3000;

export type SingState =
  | { phase: "idle" }
  | { phase: "recording"; from: number; to: number }
  | {
      phase: "review";
      /** The notes the suggestion was made for; any edit makes it stale. */
      track: NoteSeq;
      from: number;
      to: number;
      frames: SungFrame[];
      suggestion: SingSuggestion;
    }
  | { phase: "error"; reason: "noMicrophone" | "noAudio" };

export type SingAlong = {
  state: SingState;
  /** Records note range [from, to] of the current track. */
  start: (from: number, to: number) => void;
  stop: () => void;
  discard: () => void;
};

type Mikro = {
  ctx: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  /** Microphone plus output latency in ms, as far as the browser knows. */
  latenzMs: number;
};

const oeffneMikro = async (): Promise<Mikro> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Processing meant for calls bends the pitch and gates sustained tones.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_SIZE;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const spur = stream.getAudioTracks()[0];
  const eingang = (spur?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;
  const latenzMs = (eingang + ctx.baseLatency + (ctx.outputLatency || 0)) * 1000;
  return { ctx, stream, analyser, latenzMs };
};

const schliesseMikro = (m: Mikro | null): void => {
  if (!m) return;
  for (const t of m.stream.getTracks()) t.stop();
  void m.ctx.close();
};

export const useSingAlong = (
  track: NoteSeq,
  timing: Timing | null,
  playback: Playback,
): SingAlong => {
  const [state, setState] = useState<SingState>({ phase: "idle" });
  const mikroRef = useRef<Mikro | null>(null);
  const framesRef = useRef<SungFrame[]>([]);
  const trackRef = useRef(track);
  trackRef.current = track;
  // A new object every render (the position changes each frame); the loop
  // reads it here instead of restarting on every change.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const gestartetRef = useRef(false);
  /**
   * Counts takes. Opening the microphone is asynchronous (Windows may ask
   * for permission first); a take that was discarded, replaced or left
   * behind by a closing editor meanwhile must not come back to life.
   */
  const laufRef = useRef(0);
  /** The notes as they were when the take started - the indices refer to them. */
  const startTrackRef = useRef<NoteSeq | null>(null);

  const auswerten = useCallback(
    (from: number, to: number) => {
      schliesseMikro(mikroRef.current);
      mikroRef.current = null;
      const frames = framesRef.current;
      // Edited mid-take (a deleted note, a split): from/to may now point at
      // other notes. Better no suggestion than one for the wrong syllables.
      if (!timing || trackRef.current !== startTrackRef.current) {
        setState({ phase: "idle" });
        return;
      }
      setState({
        phase: "review",
        track: trackRef.current,
        from,
        to,
        frames,
        suggestion: suggestPitches(trackRef.current, from, to, timing, frames),
      });
    },
    [timing],
  );

  // Sampling loop while recording; ends when the stretch has played out.
  useEffect(() => {
    if (state.phase !== "recording") return;
    const { from, to } = state;
    const lauf = laufRef.current;
    let frame = 0;
    const t0 = performance.now();
    const puffer = new Float32Array(ANALYSER_SIZE);
    const schritt = () => {
      if (lauf !== laufRef.current) return;
      const m = mikroRef.current;
      if (m) {
        m.analyser.getFloatTimeDomainData(puffer);
        const ton = detectPitch(puffer, m.ctx.sampleRate);
        if (ton && ton.clarity >= MIN_CLARITY) {
          // The reading describes sound that left the speakers a moment ago
          // and reached the microphone just now.
          framesRef.current.push({
            ms: playbackRef.current.currentMs() - m.latenzMs,
            midi: hzToMidi(ton.hz),
          });
        }
      }
      const laeuft = playbackRef.current.playing;
      if (laeuft) gestartetRef.current = true;
      // Playback that never started (a decode error) would keep the
      // microphone open forever.
      const nieGestartet = !gestartetRef.current && performance.now() - t0 > START_TIMEOUT_MS;
      if ((gestartetRef.current && !laeuft) || nieGestartet) {
        auswerten(from, to);
        return;
      }
      frame = requestAnimationFrame(schritt);
    };
    frame = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(frame);
  }, [state, auswerten]);

  // Leaving the editor mid-take must not leave the microphone open - also
  // not one that is still being opened.
  useEffect(
    () => () => {
      laufRef.current += 1;
      schliesseMikro(mikroRef.current);
    },
    [],
  );

  const start = useCallback(
    (from: number, to: number) => {
      const erste = track.notes[from];
      const letzte = track.notes[to];
      if (!timing || !erste || !letzte) return;
      if (!playbackRef.current.available) {
        setState({ phase: "error", reason: "noAudio" });
        return;
      }
      laufRef.current += 1;
      const lauf = laufRef.current;
      void oeffneMikro()
        .then((m) => {
          if (lauf !== laufRef.current || trackRef.current !== track) {
            schliesseMikro(m);
            return;
          }
          schliesseMikro(mikroRef.current);
          mikroRef.current = m;
          framesRef.current = [];
          gestartetRef.current = false;
          startTrackRef.current = track;
          setState({ phase: "recording", from, to });
          playbackRef.current.playRange(
            beatToMs(timing, erste.beat) - LEAD_IN_MS,
            beatToMs(timing, letzte.beat + letzte.length) + TAIL_MS,
          );
        })
        .catch(() => {
          if (lauf === laufRef.current) setState({ phase: "error", reason: "noMicrophone" });
        });
    },
    [track, timing],
  );

  // Pausing ends the take; the sampling loop sees it and evaluates.
  const stop = useCallback(() => playbackRef.current.pause(), []);

  const discard = useCallback(() => {
    laufRef.current += 1;
    // A discarded take must not keep the song playing on.
    if (mikroRef.current) playbackRef.current.pause();
    schliesseMikro(mikroRef.current);
    mikroRef.current = null;
    setState({ phase: "idle" });
  }, []);

  return { state, start, stop, discard };
};
