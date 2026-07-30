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
import type { FailedDownload, Song } from "../../shared/ipcContract.ts";
import { useIpcEvent } from "../hooks.ts";

export const QueueView: FC<{ queue: Song[] }> = ({ queue }) => {
  const running = useIpcEvent("event:queueRunning", false);
  const [failed, setFailed] = useState<FailedDownload[]>([]);
  const [showFailed, setShowFailed] = useState(false);

  const refreshFailed = useCallback((): void => {
    void window.ultrastar.failedList().then(setFailed);
  }, []);
  // Refresh the list when opening the view and after every queue run
  useEffect(refreshFailed, []);
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
      <h2>Queue</h2>
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className="btn primary"
          type="button"
          disabled={running || queue.length === 0}
          onClick={() => void window.ultrastar.queueStart()}
        >
          {running ? (
            `Läuft… (${queue.length} verbleibend)`
          ) : (
            <>
              <Play size={14} aria-hidden />
              {queue.length} Songs herunterladen
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
            Abbrechen (nach aktuellem Batch)
          </button>
        )}
        <button
          className="btn danger"
          type="button"
          disabled={running || queue.length === 0}
          onClick={() => void window.ultrastar.queueClear()}
        >
          Queue leeren
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="muted">Die Queue ist leer.</p>
      ) : (
        <table className="song-table">
          <thead>
            <tr>
              <th>Interpret</th>
              <th>Titel</th>
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
                    aria-label="Entfernen"
                    title="Entfernen"
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
        <p className="muted">… und {queue.length - 200} weitere.</p>
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
          Fehlgeschlagen ({failed.length})
        </button>
        {showFailed && failed.length > 0 && (
          <table className="song-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Song</th>
                <th>Fehler</th>
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
                      Erneut
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default QueueView;
