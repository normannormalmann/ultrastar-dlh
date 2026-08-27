import type { FC } from "react";
import { useEffect, useState } from "react";
import type { CoverKandidat } from "../../../shared/ipcContract.ts";
import { useT } from "../../i18n/index.tsx";
import type { Entwurf } from "../../views/createDraft.ts";

const KACHEL = {
  width: 130,
  height: 130,
  borderRadius: 4,
  objectFit: "cover" as const,
};

/** null for "decide automatically" and for "no image" - neither is a path. */
const alsPfad = (wahl: Entwurf["coverWahl"]): string | null =>
  wahl === null || wahl === "keins" ? null : wahl.pfad;

/**
 * Step 4. Candidates land in a cache keyed by the draft id, so the job only
 * carries a path: no base64 in the persisted queue, and the choice survives a
 * restart.
 */
export const StepCover: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => {
  const t = useT();
  const [kandidaten, setKandidaten] = useState<CoverKandidat[] | null>(null);
  const [eigenes, setEigenes] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one fetch per draft, not per keystroke - artist/title/thumbnailUrl are read but must not re-trigger it, and coverWahl is written here, not read as an input.
  useEffect(() => {
    let aktiv = true;
    void window.ultrastar
      .createCoverCandidates({
        jobId: entwurf.id,
        artist: entwurf.artist,
        title: entwurf.title,
        thumbnailUrl: entwurf.thumbnailUrl ?? undefined,
      })
      .then((k) => {
        if (!aktiv) return;
        setKandidaten(k);
        // Preselect the first hit - findCover's album cover when there is one,
        // which is square and unlettered where a video thumbnail is neither.
        const beste = k[0];
        if (beste && entwurf.coverWahl === null) {
          onChange({ coverWahl: { pfad: beste.pfad } });
        }
      });
    return () => {
      aktiv = false;
    };
  }, [entwurf.id]);

  const gewaehlt = (pfad: string): boolean =>
    alsPfad(entwurf.coverWahl) === pfad;

  const waehleEigenes = async (): Promise<void> => {
    const pfad = await window.ultrastar.createChooseFile("bild");
    if (pfad === null) return;
    setEigenes(pfad);
    onChange({ coverWahl: { pfad } });
  };

  if (kandidaten === null)
    return <p className="muted">{t.create.cover.searching}</p>;

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        {kandidaten.map((k) => (
          <button
            key={k.pfad}
            type="button"
            className={gewaehlt(k.pfad) ? "btn primary" : "btn"}
            style={{ flexDirection: "column", height: "auto", padding: 8 }}
            onClick={() => onChange({ coverWahl: { pfad: k.pfad } })}
          >
            <img src={k.dataUrl} alt="" style={KACHEL} />
            <span>
              {k.kind === "caa"
                ? t.create.cover.albumCover
                : t.create.cover.youtubeImage}
            </span>
          </button>
        ))}
        <button
          type="button"
          className={
            eigenes !== null && gewaehlt(eigenes) ? "btn primary" : "btn"
          }
          style={{ flexDirection: "column", height: "auto", padding: 8 }}
          onClick={() => void waehleEigenes()}
        >
          <span style={{ ...KACHEL, display: "block", border: "1px dashed" }} />
          <span>{t.create.cover.ownFile}</span>
        </button>
        <button
          type="button"
          className={entwurf.coverWahl === "keins" ? "btn primary" : "btn"}
          style={{ flexDirection: "column", height: "auto", padding: 8 }}
          onClick={() => onChange({ coverWahl: "keins" })}
        >
          <span style={{ ...KACHEL, display: "block", border: "1px dashed" }} />
          <span>{t.create.cover.noImage}</span>
        </button>
      </div>
      {kandidaten.length === 0 && (
        <p className="muted">{t.create.cover.nothingFound}</p>
      )}
    </div>
  );
};

export default StepCover;
