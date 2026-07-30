import { Check, X } from "lucide-react";
import type { FC } from "react";
import type { ActiveDownload } from "../../shared/ipcContract.ts";

export const DownloadBar: FC<{ downloads: ActiveDownload[] }> = ({
  downloads,
}) => {
  if (downloads.length === 0) return null;
  return (
    <div className="download-bar">
      {downloads.map((d) => (
        <div
          key={d.apiId}
          className={`download-row${d.status === "failed" ? " failed" : ""}`}
        >
          <span className="name">
            {d.artist} – {d.title}
            {d.status === "failed" && d.error ? ` — ${d.error}` : ""}
          </span>
          {d.status === "downloading" && (
            <>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round(d.progress * 100)}%` }}
                />
              </div>
              <span className="muted">{Math.round(d.progress * 100)}%</span>
            </>
          )}
          {d.status === "completed" && (
            <span className="check row-inline">
              <Check size={14} aria-hidden /> fertig
            </span>
          )}
          {d.status === "failed" && <X size={14} aria-hidden />}
        </div>
      ))}
    </div>
  );
};

export default DownloadBar;
