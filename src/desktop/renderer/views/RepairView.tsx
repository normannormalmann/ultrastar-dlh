import type { FC } from "react";
import { Wrench } from "lucide-react";
import type { AppStatus } from "../../shared/ipcContract.ts";
import { useIpcEvent } from "../hooks.ts";
import { useT } from "../i18n/index.tsx";

export const RepairView: FC<{ status: AppStatus }> = ({ status }) => {
  const t = useT();
  const repair = useIpcEvent("event:repair", {
    running: false,
    progress: null,
    result: null,
  });
  const canRun =
    status.ytDlpAvailable !== false &&
    status.ffmpegAvailable !== false &&
    !repair.running;

  return (
    <div>
      <h2>{t.repair.title}</h2>
      <p className="muted" style={{ maxWidth: 560 }}>
        {t.repair.intro}
      </p>
      <button
        className="btn primary"
        type="button"
        disabled={!canRun}
        onClick={() => void window.ultrastar.repairStart()}
      >
        {repair.running ? (
          t.repair.scanRunning
        ) : (
          <>
            <Wrench size={14} aria-hidden />
            {t.repair.startScan}
          </>
        )}
      </button>

      {repair.running && repair.progress && (
        <div style={{ marginTop: 16 }}>
          <p>
            [{repair.progress.current}/{repair.progress.total}]{" "}
            <span style={{ color: "var(--yellow)" }}>
              {repair.progress.currentSong}
            </span>
          </p>
          {repair.progress.videoProgress != null && (
            <div className="row">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.round(repair.progress.videoProgress * 100)}%`,
                  }}
                />
              </div>
              <span className="muted">
                {Math.round(repair.progress.videoProgress * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {repair.result && (
        <div style={{ marginTop: 16 }}>
          <p>
            <span className="check">{t.repair.done}</span> {t.repair.repaired}{" "}
            <strong>{repair.result.fixed}</strong> / {repair.result.total}
            {repair.result.rebuilt > 0 && (
              <> · {t.repair.trackingRebuilt(repair.result.rebuilt)}</>
            )}
          </p>
          {repair.result.failed.length > 0 && (
            <>
              <p style={{ color: "var(--yellow)" }}>
                {t.repair.unrepairable(repair.result.failed.length)}
              </p>
              <ul className="muted">
                {repair.result.failed.slice(0, 15).map((name) => (
                  <li key={name}>{name}</li>
                ))}
                {repair.result.failed.length > 15 && (
                  <li>{t.repair.andMore(repair.result.failed.length - 15)}</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RepairView;
