import type { FC } from "react";
import { type Entwurf, SPRACHEN } from "../../views/createDraft.ts";

/** Step 1: the header data. Artist and title also drive the folder name. */
export const StepSong: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => (
  <div>
    <div className="row" style={{ marginBottom: 8 }}>
      <input
        className="input"
        style={{ flex: 1 }}
        placeholder="Interpret…"
        value={entwurf.artist}
        onChange={(ev) => onChange({ artist: ev.target.value })}
      />
      <input
        className="input"
        style={{ flex: 1 }}
        placeholder="Titel…"
        value={entwurf.title}
        onChange={(ev) => onChange({ title: ev.target.value })}
      />
    </div>
    <div className="row" style={{ marginBottom: 8 }}>
      {/* A list, not a text field: the value travels to whisper, which knows
          ISO codes and nothing else. */}
      <select
        className="input"
        aria-label="Sprache"
        value={entwurf.language}
        onChange={(ev) => onChange({ language: ev.target.value })}
      >
        {SPRACHEN.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        className="input"
        placeholder="Genre (optional)"
        value={entwurf.genre}
        onChange={(ev) => onChange({ genre: ev.target.value })}
      />
      <input
        className="input"
        style={{ width: 110 }}
        placeholder="Jahr (optional)"
        value={entwurf.year}
        onChange={(ev) => onChange({ year: ev.target.value })}
      />
      <input
        className="input"
        style={{ width: 110 }}
        placeholder="BPM (optional)"
        value={entwurf.bpm}
        onChange={(ev) => onChange({ bpm: ev.target.value })}
      />
    </div>
    <p className="muted">
      Interpret und Titel bestimmen auch den Ordnernamen. BPM leer lassen, wenn
      unbekannt — die Pipeline ermittelt das Tempo dann selbst.
    </p>
  </div>
);

export default StepSong;
