import type { FC } from "react";
import { spracheAnzeige, useT } from "../../i18n/index.tsx";
import { type Entwurf, SPRACHEN } from "../../views/createDraft.ts";

/** Step 1: the header data. Artist and title also drive the folder name. */
export const StepSong: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => {
  const t = useT();
  // The UI language first - the likeliest pick - then alphabetical by the
  // name actually on screen. The old hardcoded German-then-English order
  // stopped making sense once the UI itself can be English or Spanish.
  const sprachen = [...SPRACHEN].sort((a, b) => {
    const eigen = t.locale.slice(0, 2);
    if (a.code === eigen) return -1;
    if (b.code === eigen) return 1;
    return spracheAnzeige(t.locale, a.code).localeCompare(
      spracheAnzeige(t.locale, b.code),
      t.locale,
    );
  });
  return (
  <div>
    <div className="row" style={{ marginBottom: 8 }}>
      <input
        className="input"
        style={{ flex: 1 }}
        placeholder={t.create.song.artistPlaceholder}
        value={entwurf.artist}
        onChange={(ev) => onChange({ artist: ev.target.value })}
      />
      <input
        className="input"
        style={{ flex: 1 }}
        placeholder={t.create.song.titlePlaceholder}
        value={entwurf.title}
        onChange={(ev) => onChange({ title: ev.target.value })}
      />
    </div>
    <div className="row" style={{ marginBottom: 8 }}>
      {/* A list, not a text field: the value travels to whisper, which knows
          ISO codes and nothing else. */}
      <select
        className="input"
        aria-label={t.create.song.languageLabel}
        value={entwurf.language}
        onChange={(ev) => onChange({ language: ev.target.value })}
      >
        {sprachen.map((s) => (
          <option key={s.code} value={s.code}>
            {spracheAnzeige(t.locale, s.code)}
          </option>
        ))}
      </select>
      <input
        className="input"
        placeholder={t.create.song.genrePlaceholder}
        value={entwurf.genre}
        onChange={(ev) => onChange({ genre: ev.target.value })}
      />
      <input
        className="input"
        style={{ width: 110 }}
        placeholder={t.create.song.yearPlaceholder}
        value={entwurf.year}
        onChange={(ev) => onChange({ year: ev.target.value })}
      />
      <input
        className="input"
        style={{ width: 110 }}
        placeholder={t.create.song.bpmPlaceholder}
        value={entwurf.bpm}
        onChange={(ev) => onChange({ bpm: ev.target.value })}
      />
    </div>
    <p className="muted">{t.create.song.hint}</p>
  </div>
  );
};

export default StepSong;
