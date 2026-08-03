import type { FC } from "react";
import { useState } from "react";
import { resolveLyrics } from "../../../../core/create/lyrics.ts";
import type { DownloadedEntry } from "../../../shared/ipcContract.ts";
import {
  type Entwurf,
  istDuplikat,
  spracheName,
  zuJob,
} from "../../views/createDraft.ts";

/** Step 5: what will be built, before ten minutes of GPU time are spent. */
export const StepReview: FC<{
  entwurf: Entwurf;
  downloaded: DownloadedEntry[];
  onAbgeschickt: () => void;
}> = ({ entwurf, downloaded, onAbgeschickt }) => {
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
            <td>Song</td>
            <td>
              {entwurf.artist} – {entwurf.title}
            </td>
          </tr>
          <tr>
            <td>Sprache</td>
            <td>{spracheName(entwurf.language)}</td>
          </tr>
          <tr>
            <td>Quelle</td>
            <td>
              {entwurf.quelle?.kind === "youtube"
                ? entwurf.quelle.url
                : (entwurf.quelle?.pfad ?? "—")}
            </td>
          </tr>
          <tr>
            <td>Textzeilen</td>
            <td>{zeilen.length}</td>
          </tr>
          <tr>
            <td>Synchronisierte Lyrics</td>
            <td>{entwurf.syncedText ? "liegen vor" : "keine"}</td>
          </tr>
          <tr>
            <td>Bild</td>
            <td>{entwurf.coverWahl === "keins" ? "keines" : "gewählt"}</td>
          </tr>
        </tbody>
      </table>

      {doppelt && (
        <div className="error-banner" style={{ marginTop: 12 }}>
          „{entwurf.artist} – {entwurf.title}" liegt schon in der Bibliothek.
          Der neue Ordner wird danebengelegt, der alte bleibt unberührt.
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
          {laeuft ? "Wird eingereiht…" : "Zur Queue"}
        </button>
        <span className="muted">
          Gestartet wird in der Queue — dort läuft immer nur ein Song, weil es
          nur eine GPU gibt.
        </span>
      </div>
    </div>
  );
};

export default StepReview;
