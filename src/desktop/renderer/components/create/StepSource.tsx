import type { FC } from "react";
import { useState } from "react";
import type { YoutubeVideo } from "../../../shared/ipcContract.ts";
import type { Entwurf } from "../../views/createDraft.ts";

const mmss = (sek: number): string => {
  const m = Math.floor(sek / 60);
  const s = Math.round(sek % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * yt-dlp lists thumbnails smallest first, so the last one is the useful size
 * for step 4's cover candidate. Not displayed here: the renderer's CSP is
 * `img-src 'self' data:`, so a remote URL would only draw a broken image. The
 * main process fetches it and hands back a data URL.
 */
const besterThumbnail = (v: YoutubeVideo): string | null =>
  v.thumbnails.at(-1)?.url ?? null;

/**
 * Step 2. The search hit is the normal way - it brings the duration along,
 * which step 3 needs for LRCLIB. The two side entrances have to probe for it.
 */
export const StepSource: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => {
  const [treffer, setTreffer] = useState<YoutubeVideo[] | null>(null);
  const [sucht, setSucht] = useState(false);
  const [link, setLink] = useState("");
  const [meldung, setMeldung] = useState<string | null>(null);

  const istGewaehlt = (url: string): boolean =>
    entwurf.quelle?.kind === "youtube" && entwurf.quelle.url === url;

  const suche = async (): Promise<void> => {
    setSucht(true);
    setMeldung(null);
    try {
      const gefunden = await window.ultrastar.createYoutubeSearch(
        `${entwurf.artist} ${entwurf.title}`,
      );
      setTreffer(gefunden);
      if (gefunden.length === 0) {
        setMeldung(
          "Keine Treffer. Prüfe Interpret und Titel — oder füge einen Link ein.",
        );
      }
    } finally {
      setSucht(false);
    }
  };

  const uebernehmeLink = async (): Promise<void> => {
    const url = link.trim();
    if (url.length === 0) return;
    setMeldung(null);
    const info = await window.ultrastar.createSourceInfo({
      kind: "youtube",
      url,
    });
    onChange({
      quelle: { kind: "youtube", url },
      durationSec: info?.durationSec ?? null,
      thumbnailUrl: null,
    });
    if (info === null) {
      setMeldung(
        "Die Spieldauer war nicht zu ermitteln — Schritt 3 macht dann keinen Textvorschlag.",
      );
    }
  };

  const waehleDatei = async (): Promise<void> => {
    const pfad = await window.ultrastar.createChooseFile("audio");
    if (pfad === null) return;
    setMeldung(null);
    const info = await window.ultrastar.createSourceInfo({
      kind: "datei",
      pfad,
    });
    onChange({
      quelle: { kind: "datei", pfad },
      durationSec: info?.durationSec ?? null,
      thumbnailUrl: null,
    });
    if (info === null) {
      setMeldung(
        "Die Datei war nicht lesbar oder ohne erkennbare Dauer. Bitte prüfen.",
      );
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button
          className="btn"
          type="button"
          disabled={sucht}
          onClick={() => void suche()}
        >
          {sucht ? "Sucht…" : "Bei YouTube suchen"}
        </button>
        <button className="btn" type="button" onClick={() => void waehleDatei()}>
          Lokale Audiodatei…
        </button>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="…oder YouTube-Link einfügen"
          value={link}
          onChange={(ev) => setLink(ev.target.value)}
        />
        <button
          className="btn"
          type="button"
          onClick={() => void uebernehmeLink()}
        >
          Übernehmen
        </button>
      </div>

      {meldung && <p className="muted">{meldung}</p>}

      {treffer && treffer.length > 0 && (
        <table className="song-table">
          <tbody>
            {treffer.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.title}
                  <br />
                  <span className="muted">
                    {v.channel} · {mmss(v.duration)}
                  </span>
                </td>
                <td style={{ width: 110 }}>
                  <button
                    className={
                      istGewaehlt(v.url) ? "btn small primary" : "btn small"
                    }
                    type="button"
                    onClick={() =>
                      onChange({
                        quelle: { kind: "youtube", url: v.url },
                        durationSec: v.duration,
                        thumbnailUrl: besterThumbnail(v),
                      })
                    }
                  >
                    {istGewaehlt(v.url) ? "Gewählt" : "Wählen"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entwurf.quelle && (
        <p className="muted" style={{ marginTop: 12 }}>
          Gewählt:{" "}
          {entwurf.quelle.kind === "youtube"
            ? entwurf.quelle.url
            : entwurf.quelle.pfad}
          {entwurf.durationSec !== null && ` · ${mmss(entwurf.durationSec)}`}
        </p>
      )}
    </div>
  );
};

export default StepSource;
