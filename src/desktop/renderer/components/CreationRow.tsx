import { ChevronDown, ChevronRight, FolderOpen, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { CreationEntry } from "../../shared/ipcContract.ts";

/**
 * Stage labels. `stage` has two sources: creations.ts already sets German
 * ("beschaffen", "paket"), the sidecar reports English. The English names are
 * taken from python-sidecar/ultrastar_pipeline/, not guessed. An unknown stage
 * is shown verbatim - a new pipeline step must not blank the display.
 */
const STUFE: Record<string, string> = {
  beschaffen: "beschaffen",
  separate: "trennen",
  transcribe: "erkennen",
  align: "ausrichten",
  pitch: "Tonhöhe",
  tempo: "Tempo",
  notes: "Noten",
  paket: "Paket bauen",
};

const stufenText = (stage?: string): string => {
  if (!stage) return "";
  if (stage.startsWith("preload:")) return "Modelle laden";
  return STUFE[stage] ?? stage;
};

const STATUS: Record<CreationEntry["status"], string> = {
  queued: "wartet",
  running: "läuft",
  completed: "fertig",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
};

export const CreationRow: FC<{ eintrag: CreationEntry }> = ({ eintrag }) => {
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
              aria-label="Details"
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
          {STATUS[eintrag.status]}
          {eintrag.status === "running" && eintrag.stage
            ? ` · ${stufenText(eintrag.stage)}`
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
              aria-label="Entfernen"
              title="Entfernen"
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
                    Der Sync ist unsicher — die Erkennung war an mehreren
                    Stellen unschlüssig. Der Korrektur-Editor zieht das später
                    gerade.
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
                  Ordner öffnen
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
