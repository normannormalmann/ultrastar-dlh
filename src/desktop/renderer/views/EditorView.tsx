// src/desktop/renderer/views/EditorView.tsx
// The correction editor: opens song.txt of a library folder, shows it as a
// piano roll with the audio underneath, and writes it back. Covers the whole
// window, so leaving it always goes through the unsaved-changes check.
import { X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  overlaps as findeUeberlappungen,
  lineOf,
  markChecked,
  nextUnsure,
  setPitches,
  unsureRunCount,
} from "../../../core/edit/noteEdits.ts";
import {
  beatToMs,
  headerNumber,
  msToBeat,
  noteCount,
  type Track,
  timingOf,
  trackName,
  withHeader,
  withTrack,
} from "../../../core/edit/songTxt.ts";
import type { EditorError, SongTxt } from "../../shared/ipcContract.ts";
import {
  commit,
  type History,
  isDirty,
  markSaved,
  redo,
  startHistory,
  undo,
} from "../components/editor/editorHistory.ts";
import EditorToolbar from "../components/editor/EditorToolbar.tsx";
import NotePanel from "../components/editor/NotePanel.tsx";
import PianoRoll from "../components/editor/PianoRoll.tsx";
import type { SungPoint } from "../components/editor/pianoRollDraw.ts";
import SingBar from "../components/editor/SingBar.tsx";
import { useEditorKeys } from "../components/editor/useEditorKeys.ts";
import { usePlayback } from "../components/editor/usePlayback.ts";
import { useSingAlong } from "../components/editor/useSingAlong.ts";
import { type Katalog, useT } from "../i18n/index.tsx";

const ZOOM_MIN = 1;
const ZOOM_MAX = 80;
const ZOOM_START = 10;
const SAVED_FLASH_MS = 2000;
const KEINE_VORSCHLAEGE: ReadonlyMap<number, number> = new Map();

export const fehlerText = (t: Katalog, e: EditorError): string =>
  t.editor.error[e.code] +
  ("line" in e && e.line !== undefined ? t.editor.atLine(e.line) : "");

type Geladen = { revision: string; mediaUrl: string | null; converted: boolean };

export type EditorViewProps = {
  songDir: string;
  heading: string;
  onClose: () => void;
};

export const EditorView: FC<EditorViewProps> = ({ songDir, heading, onClose }) => {
  const t = useT();
  const [geladen, setGeladen] = useState<Geladen | null>(null);
  const [ladeFehler, setLadeFehler] = useState<EditorError | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // The "Edit" button that opened the editor keeps the focus, hidden behind
  // the overlay - Enter or Space would press it again. The editor takes it.
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  useEffect(() => {
    let aktiv = true;
    void window.ultrastar.editorLoad(songDir).then((r) => {
      if (!aktiv) return;
      if (!r.ok) {
        setLadeFehler(r.error);
        return;
      }
      setGeladen({ revision: r.revision, mediaUrl: r.mediaUrl, converted: r.converted });
      setHistory(startHistory(r.song));
    });
    return () => {
      aktiv = false;
    };
  }, [songDir]);

  return (
    <div className="editor-overlay" ref={overlayRef} tabIndex={-1}>
      {history && geladen ? (
        <Arbeitsflaeche
          songDir={songDir}
          heading={heading}
          history={history}
          setHistory={setHistory}
          geladen={geladen}
          setGeladen={setGeladen}
          onClose={onClose}
        />
      ) : (
        <div className="editor-toolbar">
          <strong>{heading}</strong>
          <span className={ladeFehler ? "editor-error" : "muted"}>
            {ladeFehler ? fehlerText(t, ladeFehler) : t.editor.loading}
          </span>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            <X size={14} aria-hidden />
            {t.editor.close}
          </button>
        </div>
      )}
    </div>
  );
};

type ArbeitsflaecheProps = {
  songDir: string;
  heading: string;
  history: History;
  setHistory: (h: History | ((h: History | null) => History | null)) => void;
  geladen: Geladen;
  setGeladen: (g: Geladen) => void;
  onClose: () => void;
};

/** Tabs for the voices of a duet; nothing for a solo song. */
const Spuren: FC<{ song: SongTxt; aktiv: number; onWahl: (i: number) => void }> = ({
  song,
  aktiv,
  onWahl,
}) => {
  const t = useT();
  if (song.tracks.length < 2) return null;
  return (
    <div className="editor-tracks" role="tablist">
      {song.tracks.map((spur, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: tracks have no identity beyond their position
          key={i}
          type="button"
          role="tab"
          aria-selected={i === aktiv}
          className={i === aktiv ? "btn small primary" : "btn small"}
          onClick={() => onWahl(i)}
        >
          {trackName(song, spur) ?? t.editor.voice(spur.marker ?? String(i + 1))}
        </button>
      ))}
      <span className="muted">{t.editor.voiceHint}</span>
    </div>
  );
};

const Arbeitsflaeche: FC<ArbeitsflaecheProps> = ({
  songDir,
  heading,
  history,
  setHistory,
  geladen,
  setGeladen,
  onClose,
}) => {
  const t = useT();
  const song = history.present;
  const [spur, setSpur] = useState(0);
  const track = (song.tracks[spur] ?? song.tracks[0]) as Track;
  const ghosts = useMemo(() => song.tracks.filter((_, i) => i !== spur), [song, spur]);
  const timing = useMemo(() => timingOf(song), [song]);
  const ueberlappt = useMemo(() => findeUeberlappungen(track), [track]);
  const playback = usePlayback(geladen.mediaUrl, track, timing);
  const sing = useSingAlong(track, timing, playback);

  const [selected, setSelected] = useState<number | null>(null);
  const [pxPerBeat, setPxPerBeat] = useState(ZOOM_START);
  const [scrollBeat, setScrollBeat] = useState(() => (track.notes[0]?.beat ?? 0) - 8);
  const [speichert, setSpeichert] = useState(false);
  const [gespeichert, setGespeichert] = useState(false);
  const [fehler, setFehler] = useState<EditorError | null>(null);
  const [schliessenFragen, setSchliessenFragen] = useState(false);
  const silbeRef = useRef<HTMLInputElement>(null);

  const dirty = isDirty(history);
  const anwendenSong = (next: SongTxt) => setHistory((h) => (h === null ? h : commit(h, next)));
  const anwenden = (next: Track) => anwendenSong(withTrack(song, spur, next));

  // Notes can disappear (delete, merge, undo): keep the selection valid.
  useEffect(() => {
    if (selected !== null && selected >= track.notes.length) {
      setSelected(track.notes.length > 0 ? track.notes.length - 1 : null);
    }
  }, [selected, track.notes.length]);

  // A suggestion belongs to the notes it was sung against; after any edit
  // its note indices may point elsewhere.
  const review = sing.state.phase === "review" && sing.state.track === track ? sing.state : null;
  const singDiscard = sing.discard;
  const veraltet = sing.state.phase === "review" && review === null;
  useEffect(() => {
    if (veraltet) singDiscard();
  }, [veraltet, singDiscard]);

  const sung: SungPoint[] = useMemo(() => {
    if (!review || !timing) return [];
    const versatz = 60 + 12 * review.suggestion.octaveShift;
    return review.frames.map((f) => ({ beat: msToBeat(timing, f.ms), pitch: f.midi - versatz }));
  }, [review, timing]);

  const speichern = async (danachSchliessen: boolean) => {
    if (speichert) return;
    setSpeichert(true);
    setFehler(null);
    const stand = history.present;
    const r = await window.ultrastar.editorSave({ songDir, song: stand, revision: geladen.revision });
    setSpeichert(false);
    if (!r.ok) {
      setFehler(r.error);
      setSchliessenFragen(false);
      return;
    }
    setGeladen({ ...geladen, revision: r.revision });
    setHistory((h) => (h === null ? h : markSaved(h, stand)));
    if (danachSchliessen) {
      onClose();
      return;
    }
    setGespeichert(true);
    setTimeout(() => setGespeichert(false), SAVED_FLASH_MS);
  };

  const schliessen = () => {
    if (dirty) setSchliessenFragen(true);
    else onClose();
  };

  const zoom = (neu: number, anker: number) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, neu));
    setScrollBeat(anker - (anker - scrollBeat) * (pxPerBeat / z));
    setPxPerBeat(z);
  };

  const spurWaehlen = (i: number) => {
    if (i === spur) return;
    sing.discard();
    setSpur(i);
    setSelected(null);
  };

  const einsingen = () => {
    if (selected === null || sing.state.phase === "recording") return;
    const [von, bis] = lineOf(track, selected);
    sing.start(von, bis);
  };

  const naechsteUnsicher = () => {
    const j = nextUnsure(track, selected);
    if (j >= 0) setSelected(j);
  };

  const geprueft = () => {
    if (selected !== null) anwenden(markChecked(track, selected));
  };

  const vorschlagAnnehmen = () => {
    if (!review) return;
    anwenden(setPitches(track, review.suggestion.pitches));
    sing.discard();
  };

  const keys = useEditorKeys({
    track,
    selected,
    timing,
    playback,
    setSelected,
    anwenden,
    undo: () => setHistory((h) => (h === null ? h : undo(h))),
    redo: () => setHistory((h) => (h === null ? h : redo(h))),
    speichern: () => void speichern(false),
    zoom: (faktor) => zoom(pxPerBeat * faktor, scrollBeat),
    silbeBearbeiten: () => {
      silbeRef.current?.focus();
      silbeRef.current?.select();
    },
    naechsteUnsicher,
    geprueft,
    einsingen,
    spurWechseln: () => spurWaehlen((spur + 1) % song.tracks.length),
    spurAnzahl: song.tracks.length,
    vorschlagOffen: review !== null,
    vorschlagAnnehmen,
    vorschlagVerwerfen: sing.discard,
  });

  const gap = headerNumber(song, "GAP") ?? 0;
  const playheadBeat = timing ? msToBeat(timing, playback.positionMs) : null;

  return (
    <>
      <EditorToolbar
        heading={heading}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={keys.undo}
        onRedo={keys.redo}
        playback={playback}
        hasSelection={selected !== null}
        onPlayLine={keys.playLine}
        onZoom={(faktor) => zoom(pxPerBeat * faktor, scrollBeat)}
        gap={gap}
        onGap={(v) => anwendenSong(withHeader(song, "GAP", String(v)))}
        bpm={headerNumber(song, "BPM")}
        unsureCount={unsureRunCount(track)}
        onNextUnsure={naechsteUnsicher}
        singing={sing.state.phase === "recording"}
        onSing={einsingen}
        dirty={dirty}
        saved={gespeichert}
        saving={speichert}
        onSave={() => void speichern(false)}
        onClose={schliessen}
      />

      {schliessenFragen && (
        <div className="editor-confirm">
          <span>{t.editor.unsaved}</span>
          <button className="btn primary" type="button" onClick={() => void speichern(true)}>
            {t.editor.saveAndClose}
          </button>
          <button className="btn danger" type="button" onClick={onClose}>
            {t.editor.discardAndClose}
          </button>
          <button className="btn" type="button" onClick={() => setSchliessenFragen(false)}>
            {t.editor.keepEditing}
          </button>
        </div>
      )}

      <Spuren song={song} aktiv={spur} onWahl={spurWaehlen} />
      <SingBar
        state={veraltet ? { phase: "idle" } : sing.state}
        onStop={sing.stop}
        onApply={vorschlagAnnehmen}
        onRetry={() => review && sing.start(review.from, review.to)}
        onDiscard={sing.discard}
      />

      <div className="editor-body">
        <PianoRoll
          track={track}
          ghosts={ghosts}
          selected={selected}
          overlaps={ueberlappt}
          playheadBeat={playheadBeat}
          follow={playback.playing}
          pxPerBeat={pxPerBeat}
          scrollBeat={scrollBeat}
          sung={sung}
          suggestions={review?.suggestion.pitches ?? KEINE_VORSCHLAEGE}
          onScroll={setScrollBeat}
          onZoom={zoom}
          onSelect={setSelected}
          onCommit={anwenden}
          onSeek={(beat) => {
            if (timing) playback.seek(beatToMs(timing, beat));
          }}
        />
        <NotePanel
          song={track}
          selected={selected}
          timing={timing}
          syllableRef={silbeRef}
          onPatch={keys.patch}
          onSelect={setSelected}
          onChecked={geprueft}
        />
      </div>

      <div className="editor-status">
        <span className="muted">{t.editor.noteCount(noteCount(song).toLocaleString(t.locale))}</span>
        {ueberlappt.size > 0 && (
          <span style={{ color: "var(--red)" }}>{t.editor.overlaps(ueberlappt.size)}</span>
        )}
        {!playback.available && <span className="muted">{t.editor.noAudio}</span>}
        {geladen.converted && <span className="muted">{t.editor.converted}</span>}
        {song.relative && <span className="muted">{t.editor.relativeHint}</span>}
        {fehler && <span className="editor-error">{fehlerText(t, fehler)}</span>}
        <span className="spacer" />
        <span className="muted">{t.editor.backupHint}</span>
      </div>
    </>
  );
};

export default EditorView;
