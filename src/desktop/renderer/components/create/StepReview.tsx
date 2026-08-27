import type { FC } from "react";
import { useState } from "react";
import { resolveLyrics } from "../../../../core/create/lyrics.ts";
import type { DownloadedEntry } from "../../../shared/ipcContract.ts";
import { spracheAnzeige, useT } from "../../i18n/index.tsx";
import { type Entwurf, istDuplikat, zuJob } from "../../views/createDraft.ts";

/** Step 5: what will be built, before ten minutes of GPU time are spent. */
export const StepReview: FC<{
  entwurf: Entwurf;
  downloaded: DownloadedEntry[];
  onAbgeschickt: () => void;
}> = ({ entwurf, downloaded, onAbgeschickt }) => {
  const t = useT();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const zeilen = resolveLyrics(entwurf.rohtext, entwurf.antworten);
  const doppelt = istDuplikat(entwurf, downloaded);

  const abschicken = async (): Promise<void> => {
    setLaeuft(true);
    setFehler(null);
    try {
      await window.ultrastar.createQueueAdd([zuJob(entwurf)]);
      onAbgeschickt();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div>
      <table className="song-table">
        <tbody>
          <tr>
            <td>{t.create.review.song}</td>
            <td>
              {entwurf.artist} – {entwurf.title}
            </td>
          </tr>
          <tr>
            <td>{t.create.review.language}</td>
            <td>{spracheAnzeige(t.locale, entwurf.language)}</td>
          </tr>
          <tr>
            <td>{t.create.review.source}</td>
            <td>
              {entwurf.quelle?.kind === "youtube"
                ? entwurf.quelle.url
                : (entwurf.quelle?.pfad ?? "—")}
            </td>
          </tr>
          <tr>
            <td>{t.create.review.lyricLines}</td>
            <td>{zeilen.length}</td>
          </tr>
          <tr>
            <td>{t.create.review.syncedLyrics}</td>
            <td>
              {entwurf.syncedText
                ? t.create.review.syncedPresent
                : t.create.review.syncedNone}
            </td>
          </tr>
          <tr>
            <td>{t.create.review.image}</td>
            <td>
              {entwurf.coverWahl === "keins"
                ? t.create.review.imageNone
                : t.create.review.imageChosen}
            </td>
          </tr>
        </tbody>
      </table>

      {doppelt && (
        <div className="error-banner" style={{ marginTop: 12 }}>
          {t.create.review.duplicate(
            `${entwurf.artist} – ${entwurf.title}`,
          )}
        </div>
      )}
      {fehler && (
        <div className="error-banner" style={{ marginTop: 12 }}>
          {fehler}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn primary"
          type="button"
          disabled={laeuft}
          onClick={() => void abschicken()}
        >
          {laeuft ? t.create.review.submitting : t.create.review.toQueue}
        </button>
        <span className="muted">{t.create.review.hint}</span>
      </div>
    </div>
  );
};

export default StepReview;
