// src/desktop/renderer/components/editor/NotePanel.tsx
// The selected note as form fields, its lyric line, and the shortcut list.
// Fields commit on Enter or when they lose focus, not per keystroke - typing
// "120" must be one undo step, not three.
import type { FC, KeyboardEvent, Ref } from "react";
import { Fragment } from "react";
import { lineOf, type NotePatch } from "../../../../core/edit/noteEdits.ts";
import {
  beatToMs,
  type EditNote,
  NOTE_TYPES,
  type NoteType,
  type Timing,
  type Track,
} from "../../../../core/edit/songTxt.ts";
import { Check } from "lucide-react";
import { type Katalog, useT } from "../../i18n/index.tsx";
import { pitchName } from "./usePlayback.ts";

const typText = (t: Katalog, type: NoteType): string =>
  ({
    ":": t.editor.type.normal,
    "*": t.editor.type.golden,
    F: t.editor.type.freestyle,
    R: t.editor.type.rap,
    G: t.editor.type.rapGolden,
  })[type];

export const formatMs = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  const min = Math.floor(s / 60);
  return `${min}:${(s - min * 60).toFixed(2).padStart(5, "0")}`;
};

const beiEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
  if (e.key === "Escape") {
    e.currentTarget.value = e.currentTarget.defaultValue;
    e.currentTarget.blur();
  }
};

const ZahlFeld: FC<{
  label: string;
  wert: number;
  onWert: (v: number) => void;
}> = ({ label, wert, onWert }) => (
  <label className="editor-field">
    <span className="muted">{label}</span>
    <input
      key={wert}
      className="input"
      type="number"
      step={1}
      defaultValue={wert}
      onKeyDown={beiEnter}
      onBlur={(e) => {
        // Number("") is 0: a cleared field would move the note to beat 0.
        const roh = e.currentTarget.value.trim();
        const v = Number(roh);
        if (roh !== "" && Number.isFinite(v) && v !== wert) onWert(v);
      }}
    />
  </label>
);

export type NotePanelProps = {
  song: Track;
  selected: number | null;
  timing: Timing | null;
  syllableRef: Ref<HTMLInputElement>;
  onPatch: (index: number, patch: NotePatch) => void;
  onSelect: (index: number) => void;
  /** Clears the doubt on the stretch around the selected note. */
  onChecked: () => void;
};

export const NotePanel: FC<NotePanelProps> = ({
  song,
  selected,
  timing,
  syllableRef,
  onPatch,
  onSelect,
  onChecked,
}) => {
  const t = useT();
  const note: EditNote | undefined =
    selected === null ? undefined : song.notes[selected];

  return (
    <aside className="editor-panel">
      <h3>{t.editor.noteTitle}</h3>
      {note === undefined || selected === null ? (
        <p className="muted">{t.editor.noSelection}</p>
      ) : (
        // Keyed by the selection: a field showing the same number for the
        // next note must still start fresh.
        <Fragment key={selected}>
          {note.unsure && (
            <div className="editor-unsure">
              <span>
                {note.unsure === "interpolated"
                  ? t.editor.unsureInterpolated
                  : t.editor.unsureLow}
              </span>
              <button className="btn small" type="button" onClick={onChecked}>
                <Check size={14} aria-hidden />
                {t.editor.markChecked}
              </button>
            </div>
          )}
          <label className="editor-field">
            <span className="muted">{t.editor.syllable}</span>
            <input
              key={`${selected}:${note.syllable}`}
              ref={syllableRef}
              className="input"
              defaultValue={note.syllable}
              onKeyDown={beiEnter}
              onBlur={(e) => {
                const v = e.currentTarget.value;
                if (v !== note.syllable) onPatch(selected, { syllable: v });
              }}
            />
          </label>
          <div className="editor-field-row">
            <ZahlFeld
              label={t.editor.beat}
              wert={note.beat}
              onWert={(v) => onPatch(selected, { beat: v })}
            />
            <ZahlFeld
              label={t.editor.length}
              wert={note.length}
              onWert={(v) => onPatch(selected, { length: v })}
            />
          </div>
          <div className="editor-field-row">
            <ZahlFeld
              label={`${t.editor.pitch} · ${pitchName(note.pitch)}`}
              wert={note.pitch}
              onWert={(v) => onPatch(selected, { pitch: v })}
            />
            <label className="editor-field">
              <span className="muted">{t.editor.noteType}</span>
              <select
                className="input"
                value={note.type}
                onChange={(e) =>
                  onPatch(selected, { type: e.currentTarget.value as NoteType })
                }
              >
                {NOTE_TYPES.map((typ) => (
                  <option key={typ} value={typ}>
                    {typText(t, typ)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {timing && (
            <p className="muted">
              {t.editor.time}: {formatMs(beatToMs(timing, note.beat))}
            </p>
          )}
          <Zeile song={song} selected={selected} onSelect={onSelect} />
        </Fragment>
      )}
      <details className="editor-help">
        <summary>{t.editor.shortcutsTitle}</summary>
        <table>
          <tbody>
            {t.editor.shortcuts.map(([tasten, text]) => (
              <tr key={tasten}>
                <td>
                  <kbd>{tasten}</kbd>
                </td>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">{t.editor.mouseHint}</p>
      </details>
    </aside>
  );
};

/** The lyric line of the selected note; a click on a syllable selects it. */
const Zeile: FC<{
  song: Track;
  selected: number;
  onSelect: (index: number) => void;
}> = ({ song, selected, onSelect }) => {
  const t = useT();
  const [von, bis] = lineOf(song, selected);
  const teile = song.notes.slice(von, bis + 1);
  return (
    <div className="editor-line">
      <span className="muted">{t.editor.line}</span>
      <p>
        {teile.map((n, k) => {
          const index = von + k;
          return (
            <button
              key={index}
              type="button"
              className={index === selected ? "syl active" : "syl"}
              onClick={() => onSelect(index)}
            >
              {n.syllable}
            </button>
          );
        })}
      </p>
    </div>
  );
};

export default NotePanel;
