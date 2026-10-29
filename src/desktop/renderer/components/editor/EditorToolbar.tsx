// src/desktop/renderer/components/editor/EditorToolbar.tsx
// The editor's top bar. Stateless: every button says what it wants through
// a callback, EditorView decides.
import {
  CircleAlert,
  Mic,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import { useT } from "../../i18n/index.tsx";
import type { Playback } from "./usePlayback.ts";

export type EditorToolbarProps = {
  heading: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  playback: Playback;
  hasSelection: boolean;
  onPlayLine: () => void;
  onZoom: (faktor: number) => void;
  gap: number;
  onGap: (ms: number) => void;
  bpm: number | undefined;
  unsureCount: number;
  onNextUnsure: () => void;
  singing: boolean;
  onSing: () => void;
  dirty: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
};

const Knopf: FC<{
  titel: string;
  onClick: () => void;
  disabled?: boolean;
  aktiv?: boolean;
  children: ReactNode;
}> = ({ titel, onClick, disabled, aktiv, children }) => (
  <button
    className={aktiv ? "btn small primary" : "btn small"}
    type="button"
    title={titel}
    aria-label={titel}
    aria-pressed={aktiv}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

export const EditorToolbar: FC<EditorToolbarProps> = (p) => {
  const t = useT();
  const pb = p.playback;
  return (
    <div className="editor-toolbar">
      <strong className="editor-heading">{p.heading}</strong>
      <Knopf titel={t.editor.undo} disabled={!p.canUndo} onClick={p.onUndo}>
        <Undo2 size={14} aria-hidden />
      </Knopf>
      <Knopf titel={t.editor.redo} disabled={!p.canRedo} onClick={p.onRedo}>
        <Redo2 size={14} aria-hidden />
      </Knopf>
      <span className="editor-sep" />
      <Knopf
        titel={pb.playing ? t.editor.pause : t.editor.play}
        disabled={!pb.available}
        onClick={pb.toggle}
      >
        {pb.playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
      </Knopf>
      <Knopf
        titel={t.editor.playLine}
        disabled={!pb.available || !p.hasSelection}
        onClick={p.onPlayLine}
      >
        <SkipForward size={14} aria-hidden />
      </Knopf>
      <Knopf titel={t.editor.tones} aktiv={pb.tones} onClick={() => pb.setTones(!pb.tones)}>
        <Music size={14} aria-hidden />
      </Knopf>
      <Knopf
        titel={t.editor.singIn}
        aktiv={p.singing}
        disabled={!pb.available || !p.hasSelection}
        onClick={p.onSing}
      >
        <Mic size={14} aria-hidden />
      </Knopf>
      <span className="muted editor-time">{(pb.positionMs / 1000).toFixed(2)} s</span>
      <span className="editor-sep" />
      <Knopf titel={t.editor.zoomOut} onClick={() => p.onZoom(0.8)}>
        <Minus size={14} aria-hidden />
      </Knopf>
      <Knopf titel={t.editor.zoomIn} onClick={() => p.onZoom(1.25)}>
        <Plus size={14} aria-hidden />
      </Knopf>
      <span className="editor-sep" />
      <label className="editor-inline">
        <span className="muted">{t.editor.gap}</span>
        <input
          key={p.gap}
          className="input editor-gap"
          type="number"
          step={10}
          defaultValue={p.gap}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => {
            // Not rounded: a file's "1200,5" must survive a mere focus.
            const roh = e.currentTarget.value.trim();
            const v = Number(roh);
            if (roh !== "" && Number.isFinite(v) && v !== p.gap) p.onGap(v);
          }}
        />
      </label>
      {p.bpm !== undefined && (
        <span className="muted">
          {t.editor.bpm} {p.bpm.toLocaleString(t.locale)}
        </span>
      )}
      {p.unsureCount > 0 && (
        <button
          className="btn small editor-unsure-btn"
          type="button"
          title={t.editor.nextUnsure}
          onClick={p.onNextUnsure}
        >
          <CircleAlert size={14} aria-hidden />
          {t.editor.unsureCount(p.unsureCount)}
        </button>
      )}
      <span className="spacer" />
      {p.saved && <span style={{ color: "var(--green)" }}>{t.editor.saved}</span>}
      {p.dirty && !p.saved && <span style={{ color: "var(--yellow)" }}>{t.editor.unsaved}</span>}
      <button
        className="btn primary"
        type="button"
        disabled={!p.dirty || p.saving}
        onClick={p.onSave}
      >
        <Save size={14} aria-hidden />
        {p.saving ? t.editor.saving : t.editor.save}
      </button>
      <button className="btn" type="button" onClick={p.onClose}>
        <X size={14} aria-hidden />
        {t.editor.close}
      </button>
    </div>
  );
};

export default EditorToolbar;
