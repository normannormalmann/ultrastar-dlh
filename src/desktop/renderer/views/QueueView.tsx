import type { FC } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  CreationEntry,
  FailedDownload,
  Song,
} from "../../shared/ipcContract.ts";
import CreationRow from "../components/CreationRow.tsx";
import { useIpcEvent } from "../hooks.ts";
import { useT } from "../i18n/index.tsx";

export const QueueView: FC<{ queue: Song[]; creations: CreationEntry[] }> = ({
  queue,
  creations,
}) => {
  const t = useT();
  const running = useIpcEvent("event:queueRunning", false);
  const [failed, setFailed] = useState<FailedDownload[]>([]);
  const [showFailed, setShowFailed] = useState(false);
  const wartend = creations.filter((c) => c.status === "queued").length;
  const laeuftErstellung = creations.some((c) => c.status === "running");

  const refreshFailed = useCallback((): void => {
    void window.ultrastar.failedList().then(setFailed);
  }, []);
  // Refresh the list when opening the view and after every queue run.
  // refreshFailed is a useCallback with empty deps, so its identity is stable
  // and naming it here keeps the effect a mount-only run.
  useEffect(refreshFailed, [refreshFailed]);
  useEffect(() => {
    if (!running) refreshFailed();
  }, [running, refreshFailed]);

  const retry = (f: FailedDownload): void => {
    void window.ultrastar.queueAdd([
      { apiId: f.apiId, artist: f.artist, title: f.title, languages: [] },
    ]);
  };

  return (
    <div>
      <h2>{t.queue.title}</h2>
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className="btn primary"
          type="button"
          disabled={running || queue.length === 0}
          onClick={() => void window.ultrastar.queueStart()}
        >
          {running ? (
            t.queue.runningWithRest(queue.length)
          ) : (
            <>
              <Play size={14} aria-hidden />
              {t.queue.downloadN(queue.length)}
            </>
          )}
        </button>
        {running && (
          <button
            className="btn"
            type="button"
            onClick={() => void window.ultrastar.queueCancel()}
          >
            <Pause size={14} aria-hidden />
            {t.queue.cancelAfterBatch}
          </button>
        )}
        <button
          className="btn danger"
          type="button"
          disabled={running || queue.length === 0}
          onClick={() => void window.ultrastar.queueClear()}
        >
          {t.queue.clear}
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="muted">{t.queue.empty}</p>
      ) : (
        <table className="song-table">
          <thead>
            <tr>
              <th>{t.queue.colArtist}</th>
              <th>{t.queue.colTitle}</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {queue.slice(0, 200).map((s) => (
              <tr key={s.apiId}>
                <td style={{ color: "var(--yellow)" }}>{s.artist}</td>
                <td>{s.title}</td>
                <td>
                  <button
                    className="btn small"
                    type="button"
                    aria-label={t.queue.remove}
                    title={t.queue.remove}
                    disabled={running}
                    onClick={() => void window.ultrastar.queueRemove(s.apiId)}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {queue.length > 200 && (
        <p className="muted">{t.queue.andMore(queue.length - 200)}</p>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          className="btn small"
          type="button"
          onClick={() => setShowFailed((v) => !v)}
        >
          {showFailed ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
          {t.queue.failed(failed.length)}
        </button>
        {showFailed && failed.length > 0 && (
          <table className="song-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t.queue.colSong}</th>
                <th>{t.queue.colError}</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {failed.map((f) => (
                <tr key={`${f.apiId}-${f.timestamp}`}>
                  <td>
                    {f.artist} – {f.title}
                  </td>
                  <td className="muted" style={{ maxWidth: 420 }}>
                    {f.error}
                  </td>
                  <td>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() => retry(f)}
                    >
                      <RotateCcw size={14} aria-hidden />
                      {t.queue.retry}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <h3>{t.queue.creations}</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn primary"
            type="button"
            disabled={wartend === 0 || laeuftErstellung}
            onClick={() => void window.ultrastar.createStart()}
          >
            <Play size={14} aria-hidden />
            {t.queue.createN(wartend)}
          </button>
          {laeuftErstellung && (
            <button
              className="btn"
              type="button"
              onClick={() => void window.ultrastar.createCancel()}
            >
              {t.queue.cancelCurrent}
            </button>
          )}
          <button
            className="btn danger"
            type="button"
            disabled={wartend === 0}
            onClick={() => void window.ultrastar.createQueueClear()}
          >
            {t.queue.removeWaiting}
          </button>
        </div>
        {creations.length === 0 ? (
          <p className="muted">{t.queue.noCreations}</p>
        ) : (
          <table className="song-table">
            <tbody>
              {creations.map((c) => (
                <CreationRow key={c.id} eintrag={c} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default QueueView;
