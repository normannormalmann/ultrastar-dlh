import { ChevronDown, ChevronRight, FolderOpen, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { CreationEntry } from "../../shared/ipcContract.ts";
import { type Katalog, useT } from "../i18n/index.tsx";

/**
 * Stage names have two sources: creations.ts sets the German ones
 * ("beschaffen", "paket"), the sidecar reports English ones taken from
 * python-sidecar/ultrastar_pipeline/. Both are catalog keys. An unknown stage
 * is shown verbatim - a new pipeline step must not blank the display.
 */
const stufenText = (t: Katalog, stage?: string): string => {
  if (!stage) return "";
  if (stage.startsWith("preload:")) return t.creation.stage.loadModels;
  const stufen: Record<string, string> = t.creation.stage;
  return stufen[stage] ?? stage;
};

export const CreationRow: FC<{ eintrag: CreationEntry }> = ({ eintrag }) => {
  const t = useT();
  const [offen, setOffen] = useState(false);
  const [cover, setCover] = useState<string | null>(null);
  const fertig = eintrag.status === "completed";

  useEffect(() => {
    if (!offen || eintrag.songDir === undefined) return;
    void window.ultrastar.coverGetLocal(eintrag.songDir).then(setCover);
  }, [offen, eintrag.songDir]);

  return (
    <>
      <tr>
        <td style={{ width: 40 }}>
          {fertig && (
            <button
              className="btn small"
              type="button"
              aria-label={t.creation.details}
              onClick={() => setOffen((v) => !v)}
            >
              {offen ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </button>
          )}
        </td>
        <td style={{ color: "var(--yellow)" }}>{eintrag.artist}</td>
        <td>{eintrag.title}</td>
        <td className="muted">
          {t.creation.status[eintrag.status]}
          {eintrag.status === "running" && eintrag.stage
            ? ` · ${stufenText(t, eintrag.stage)}`
            : ""}
          {eintrag.error ? ` · ${eintrag.error}` : ""}
        </td>
        <td style={{ width: 140 }}>
          {eintrag.status === "running" && (
            <progress value={eintrag.progress ?? 0} max={1} />
          )}
        </td>
        <td style={{ width: 60 }}>
          {eintrag.status === "queued" && (
            <button
              className="btn small"
              type="button"
              aria-label={t.creation.remove}
              title={t.creation.remove}
              onClick={() => void window.ultrastar.createQueueRemove(eintrag.id)}
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </td>
      </tr>
      {offen && fertig && (
        <tr>
          <td />
          <td colSpan={5}>
            <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
              {cover && (
                <img
                  src={cover}
                  alt=""
                  style={{ width: 90, height: 90, borderRadius: 4 }}
                />
              )}
              <div>
                <div>{eintrag.dirName}</div>
                {eintrag.lowConfidence && (
                  <div style={{ color: "var(--yellow)" }}>
                    {t.creation.lowConfidence}
                  </div>
                )}
                <button
                  className="btn small"
                  type="button"
                  onClick={() =>
                    void window.ultrastar.openFolder(eintrag.songDir ?? "")
                  }
                >
                  <FolderOpen size={14} aria-hidden />
                  {t.creation.openFolder}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default CreationRow;
