// src/desktop/renderer/components/editor/usePlayback.ts
// Audio for the editor: plays the song file, reports the position every
// frame, can stop at a given time ("play this line"), and can sound the
// note under the playhead as a plain tone - the quickest way to hear
// whether a pitch is right.
import { useCallback, useEffect, useRef, useState } from "react";
import { noteAtBeat } from "../../../../core/edit/noteEdits.ts";
import { msToBeat, type NoteSeq, type Timing } from "../../../../core/edit/songTxt.ts";

/** UltraStar pitch 0 is C4, MIDI note 60. */
export const pitchToHz = (pitch: number): number =>
  440 * 2 ** ((pitch + 60 - 69) / 12);

const NOTENNAMEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const pitchName = (pitch: number): string => {
  const midi = pitch + 60;
  return `${NOTENNAMEN[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};

const TON_LAUTSTAERKE = 0.08;

export type Playback = {
  playing: boolean;
  /** Audio position in milliseconds. */
  positionMs: number;
  available: boolean;
  tones: boolean;
  setTones: (on: boolean) => void;
  toggle: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  /** Plays from..to and stops; the position then returns to from. */
  playRange: (fromMs: number, toMs: number) => void;
  /** The position right now, read from the audio element - not a render behind. */
  currentMs: () => number;
};

/** Tones follow the track being edited - in a duet, the selected singer. */
export const usePlayback = (
  mediaUrl: string | null,
  song: NoteSeq,
  timing: Timing | null,
): Playback => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopBeiRef = useRef<{ bis: number; zurueck: number } | null>(null);
  const tonRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);
  // The frame loop reads these through refs: a new song after every edit
  // must not restart the loop.
  const songRef = useRef(song);
  const timingRef = useRef(timing);
  songRef.current = song;
  timingRef.current = timing;

  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [tones, setTonesState] = useState(false);
  const tonesRef = useRef(false);

  useEffect(() => {
    if (!mediaUrl) return;
    const audio = new Audio(mediaUrl);
    audio.preload = "auto";
    audioRef.current = audio;
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.pause();
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, [mediaUrl]);

  useEffect(
    () => () => {
      void tonRef.current?.ctx.close();
      tonRef.current = null;
    },
    [],
  );

  const stummschalten = useCallback(() => {
    const ton = tonRef.current;
    if (ton) ton.gain.gain.setTargetAtTime(0, ton.ctx.currentTime, 0.01);
  }, []);

  const tonFuer = useCallback((ms: number) => {
    const ton = tonRef.current;
    const t = timingRef.current;
    if (!ton || !t) return;
    const s = songRef.current;
    const beat = msToBeat(t, ms);
    const i = noteAtBeat(s, beat);
    const note = s.notes[i];
    const klingt = note !== undefined && beat < note.beat + note.length && note.type !== "F";
    if (klingt) ton.osc.frequency.setTargetAtTime(pitchToHz(note.pitch), ton.ctx.currentTime, 0.005);
    ton.gain.gain.setTargetAtTime(klingt ? TON_LAUTSTAERKE : 0, ton.ctx.currentTime, 0.01);
  }, []);

  useEffect(() => {
    if (!playing) {
      stummschalten();
      return;
    }
    let frame = 0;
    const schritt = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const ms = audio.currentTime * 1000;
      const stop = stopBeiRef.current;
      if (stop && ms >= stop.bis) {
        stopBeiRef.current = null;
        audio.pause();
        audio.currentTime = stop.zurueck / 1000;
        setPositionMs(stop.zurueck);
        return;
      }
      setPositionMs(ms);
      if (tonesRef.current) tonFuer(ms);
      frame = requestAnimationFrame(schritt);
    };
    frame = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(frame);
  }, [playing, stummschalten, tonFuer]);

  const setTones = useCallback(
    (on: boolean) => {
      tonesRef.current = on;
      setTonesState(on);
      if (!on) {
        stummschalten();
        return;
      }
      if (tonRef.current) return;
      // Created on first use: an AudioContext made before any user gesture
      // starts suspended.
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      tonRef.current = { ctx, osc, gain };
    },
    [stummschalten],
  );

  const pause = useCallback(() => {
    stopBeiRef.current = null;
    audioRef.current?.pause();
  }, []);

  const seek = useCallback((ms: number) => {
    const ziel = Math.max(0, ms);
    if (audioRef.current) audioRef.current.currentTime = ziel / 1000;
    setPositionMs(ziel);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    stopBeiRef.current = null;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const playRange = useCallback((fromMs: number, toMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const von = Math.max(0, fromMs);
    stopBeiRef.current = { bis: toMs, zurueck: von };
    audio.currentTime = von / 1000;
    void audio.play();
  }, []);

  const currentMs = useCallback(
    () => (audioRef.current ? audioRef.current.currentTime * 1000 : 0),
    [],
  );

  return {
    currentMs,
    playing,
    positionMs,
    available: mediaUrl !== null,
    tones,
    setTones,
    toggle,
    pause,
    seek,
    playRange,
  };
};
