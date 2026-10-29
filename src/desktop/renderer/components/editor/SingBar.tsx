// src/desktop/renderer/components/editor/SingBar.tsx
// The strip that appears while singing a stretch in and while its result
// waits for a decision.
import { Check, Mic, RotateCcw, Square, X } from "lucide-react";
import type { FC } from "react";
import { useT } from "../../i18n/index.tsx";
import type { SingState } from "./useSingAlong.ts";

export type SingBarProps = {
  state: SingState;
  onStop: () => void;
  onApply: () => void;
  onRetry: () => void;
  onDiscard: () => void;
};

export const SingBar: FC<SingBarProps> = ({ state, onStop, onApply, onRetry, onDiscard }) => {
  const t = useT();
  if (state.phase === "idle") return null;

  if (state.phase === "error") {
    return (
      <div className="editor-sing">
        <span className="editor-error">
          {state.reason === "noMicrophone" ? t.editor.singNoMic : t.editor.noAudio}
        </span>
        <button className="btn small" type="button" onClick={onDiscard}>
          <X size={14} aria-hidden />
          {t.editor.close}
        </button>
      </div>
    );
  }

  if (state.phase === "recording") {
    return (
      <div className="editor-sing recording">
        <Mic size={14} aria-hidden />
        <span>{t.editor.singRecording}</span>
        <span className="muted">{t.editor.singHeadphones}</span>
        <span className="spacer" />
        <button className="btn small" type="button" onClick={onStop}>
          <Square size={14} aria-hidden />
          {t.editor.singStop}
        </button>
      </div>
    );
  }

  const { suggestion } = state;
  const aenderungen = suggestion.pitches.size;
  return (
    <div className="editor-sing">
      <Mic size={14} aria-hidden />
      <span>
        {suggestion.judged === 0
          ? t.editor.singNothing
          : t.editor.singResult(aenderungen, suggestion.judged)}
        {suggestion.octaveShift !== 0 && ` ${t.editor.singOctave(suggestion.octaveShift)}`}
      </span>
      <span className="spacer" />
      <button
        className="btn small primary"
        type="button"
        disabled={aenderungen === 0}
        onClick={onApply}
      >
        <Check size={14} aria-hidden />
        {t.editor.singApply}
      </button>
      <button className="btn small" type="button" onClick={onRetry}>
        <RotateCcw size={14} aria-hidden />
        {t.editor.singRetry}
      </button>
      <button className="btn small" type="button" onClick={onDiscard}>
        <X size={14} aria-hidden />
        {t.editor.singDiscard}
      </button>
    </div>
  );
};

export default SingBar;
