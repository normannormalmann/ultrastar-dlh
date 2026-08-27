import type { FC } from "react";
import { Wrench } from "lucide-react";
import type {
  AppStatus,
  RepairErrorType,
  RepairResultWire,
} from "../../shared/ipcContract.ts";
import { useIpcEvent } from "../hooks.ts";
import { useT } from "../i18n/index.tsx";

/**
 * Failures grouped by reason, biggest group first. A bare list of folder
 * names says nothing about what to do; the reason does. Songs without an
 * error entry fall under "unknown" so the groups always add up to the
 * failed count.
 */
const nachGrund = (
  r: RepairResultWire,
): Array<[RepairErrorType, string[]]> => {
  const grundFuer = new Map(r.errors);
  const gruppen = new Map<RepairErrorType, string[]>();
  for (const name of r.failed) {
    const typ = grundFuer.get(name)?.type ?? "unknown";
    gruppen.set(typ, [...(gruppen.get(typ) ?? []), name]);
  }
  return [...gruppen.entries()].sort((a, b) => b[1].length - a[1].length);
};

/** Names shown per group before it collapses into a count. */
const NAMEN_PRO_GRUPPE = 10;

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
              {nachGrund(repair.result).map(([typ, namen]) => (
                <div key={typ} style={{ marginTop: 12 }}>
                  <p style={{ marginBottom: 2 }}>
                    <strong>{t.repair.reason[typ].label}</strong> (
                    {namen.length})
                  </p>
                  <p className="muted" style={{ marginTop: 0, maxWidth: 620 }}>
                    {t.repair.reason[typ].hint}
                  </p>
                  <ul className="muted">
                    {namen.slice(0, NAMEN_PRO_GRUPPE).map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                    {namen.length > NAMEN_PRO_GRUPPE && (
                      <li>
                        {t.repair.andMore(namen.length - NAMEN_PRO_GRUPPE)}
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RepairView;
