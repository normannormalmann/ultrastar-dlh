import { useEffect, useRef, useState } from "react";
import type { DownloadedEntry } from "../../shared/ipcContract.ts";
import type { LibraryReport } from "../../../core/library/inspect.ts";
import type { UsdbUpdate } from "../../../core/library/usdbUpdates.ts";

type Update = UsdbUpdate & { proposedText?: string };
export const LibraryTools = ({ entries }: { entries: DownloadedEntry[] }) => {
  const [report, setReport] = useState<LibraryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [updates, setUpdates] = useState<Update[]>([]);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [limit, setLimit] = useState(100);
  const [applying, setApplying] = useState<string | null>(null);
  const cancel = useRef(false);
  useEffect(
    () => () => {
      cancel.current = true;
    },
    [],
  );

  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      setReport(await window.ultrastar.libraryInspect());
      setLimit(100);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const checkUpdates = async () => {
    cancel.current = false;
    setChecking(true);
    setUpdates([]);
    setError("");
    const songs = entries.filter((entry) => entry.apiId > 0);
    setProgress({ current: 0, total: songs.length });
    for (const [index, song] of songs.entries()) {
      if (cancel.current) break;
      try {
        const result = await window.ultrastar.libraryUsdbCheck(song.songDir);
        if (!cancel.current && result.status !== "current")
          setUpdates((previous) => [...previous, result]);
      } catch (e) {
        if (!cancel.current)
          setUpdates((previous) => [
            ...previous,
            { ...song, status: "error", message: String(e) },
          ]);
      }
      if (cancel.current) break;
      setProgress({ current: index + 1, total: songs.length });
      // Keep a large archive from hammering USDB.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    setChecking(false);
  };
  const apply = async (update: Update, keepLocal = false) => {
    if (!update.localRevision || !update.remoteRevision) return;
    setApplying(update.songDir);
    setError("");
    try {
      await window.ultrastar.libraryUsdbApply({
        songDir: update.songDir,
        localRevision: update.localRevision,
        remoteRevision: update.remoteRevision,
        keepLocal,
      });
      setUpdates((previous) =>
        previous.filter((item) => item.songDir !== update.songDir),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(null);
    }
  };
  return (
    <section className="library-tools" aria-label="Bibliotheksprüfung">
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void inspect()}
        >
          {busy ? "Bibliothek wird geprüft …" : "Gültigkeit & Duplikate prüfen"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={checking}
          onClick={() => void checkUpdates()}
        >
          USDB-Updates prüfen ({entries.filter((e) => e.apiId > 0).length})
        </button>
        {checking && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              cancel.current = true;
            }}
          >
            Prüfung stoppen
          </button>
        )}
        {progress && (
          <span role="status">
            USDB: {progress.current} / {progress.total}
            {checking ? " …" : " geprüft"}
          </span>
        )}
      </div>
      <p className="muted">
        Die Dateiprüfung umfasst die gesamte Bibliothek. USDB prüft die aktuell
        gefilterten Songs mit bekannter USDB-ID.
      </p>
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}
      {report && (
        <details open>
          <summary>
            {report.scanned} Songs geprüft · {report.issues.length} Hinweise ·{" "}
            {report.duplicates.length} mögliche Duplikatgruppen
          </summary>
          {report.issues.length === 0 && (
            <p>Keine Fehler in den geprüften Dateien gefunden.</p>
          )}
          <ul>
            {report.issues.slice(0, limit).map((issue) => (
              <li key={`${issue.file}-${issue.message}`}>
                <strong>
                  {issue.severity === "error" ? "Fehler" : "Hinweis"}
                </strong>
                : {issue.message}
                <br />
                <small>{issue.file}</small>
              </li>
            ))}
          </ul>
          {report.issues.length > limit && (
            <button
              type="button"
              className="btn"
              onClick={() => setLimit((value) => value + 100)}
            >
              Weitere Hinweise anzeigen
            </button>
          )}
          {report.duplicates.slice(0, limit).map((group) => (
            <details key={group[0]?.file}>
              <summary>
                {group[0]?.artist} – {group[0]?.title} ({group.length} Ordner)
              </summary>
              <p className="muted">
                Gleiche Namen können auch verschiedene Versionen oder Duette
                bezeichnen. Bitte vor dem Löschen vergleichen.
              </p>
              <ul>
                {group.map((song) => (
                  <li key={song.file}>
                    {song.songDir}{" "}
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        void window.ultrastar
                          .openFolder(song.songDir)
                          .catch((e) => setError(String(e)))
                      }
                    >
                      Ordner öffnen
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {report.duplicates.length > limit && (
            <button
              type="button"
              className="btn"
              onClick={() => setLimit((value) => value + 100)}
            >
              Weitere Duplikate anzeigen
            </button>
          )}
        </details>
      )}
      {progress && !checking && updates.length === 0 && (
        <p>Bei den geprüften Songs wurden keine USDB-Änderungen gefunden.</p>
      )}
      {updates.map((update) => (
        <details key={update.songDir}>
          <summary>
            {update.artist} – {update.title}:{" "}
            {update.status === "available"
              ? "Neue USDB-Fassung"
              : update.status === "unknown"
                ? "Unterschied zur aktuellen USDB-Fassung (Erstabgleich)"
                : "Prüfung fehlgeschlagen"}
          </summary>
          <p>{update.songDir}</p>
          {update.message && <p>{update.message}</p>}
          {update.baseText && (
            <details>
              <summary>Gespeicherte USDB-Ausgangsfassung</summary>
              <pre className="library-update-preview">{update.baseText}</pre>
            </details>
          )}
          {update.localText && (
            <details>
              <summary>Meine lokale Fassung</summary>
              <pre className="library-update-preview">{update.localText}</pre>
            </details>
          )}
          {update.conflict && (
            <p role="alert">
              Konflikt: Sowohl die lokale Fassung als auch USDB unterscheiden
              sich von der gespeicherten Ausgangsfassung. Bitte vor dem
              Übernehmen vergleichen.
            </p>
          )}
          {update.proposedText && (
            <>
              <p>
                {update.status === "unknown"
                  ? "Ohne gespeicherte Ausgangsfassung lässt sich nicht feststellen, ob USDB seit dem Download geändert wurde. "
                  : ""}
                Die folgende Fassung ersetzt Noten und Timing. Lokale
                Mediendateien bleiben zugeordnet. Eigene Notenkorrekturen werden
                ersetzt; zuvor entsteht eine datierte Sicherung von song.txt.
              </p>
              <pre className="library-update-preview">
                {update.proposedText}
              </pre>
              <button
                type="button"
                className="btn"
                disabled={applying !== null}
                onClick={() => void apply(update)}
              >
                {applying === update.songDir
                  ? "Wird übernommen …"
                  : "Diese Fassung übernehmen und Original sichern"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={applying !== null}
                onClick={() => void apply(update, true)}
              >
                Lokale Fassung behalten und USDB ab jetzt beobachten
              </button>
            </>
          )}
        </details>
      ))}
    </section>
  );
};
