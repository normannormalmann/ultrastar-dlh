import type { FC } from "react";
import { useEffect, useState } from "react";
import { Check, Download, RefreshCw, Trash2 } from "lucide-react";
import type {
  AppConfig,
  BinariesStatus,
  EnvironmentStatus,
  UpdateState,
} from "../../shared/ipcContract.ts";
import { useIpcEvent } from "../hooks.ts";

const BROWSERS = [
  "edge",
  "chrome",
  "firefox",
  "brave",
  "chromium",
  "opera",
  "vivaldi",
] as const;

const sourceLabel = (s: "system" | "managed" | "missing"): string =>
  s === "system" ? "System" : s === "managed" ? "App-verwaltet" : "fehlt";

const envLabel = (s: EnvironmentStatus): string =>
  s.state === "ready"
    ? `bereit (${s.torchVariante === "cu128" ? "GPU" : "CPU"}, Python ${s.pythonVersion ?? "?"})`
    : s.state === "outdated"
      ? "veraltet - Aktualisierung empfohlen"
      : s.state === "broken"
        ? `defekt (Schritt ${s.fehler?.schritt ?? "?"})`
        : "nicht eingerichtet";

const updateLabel = (u: UpdateState): string => {
  switch (u.phase) {
    case "disabled":
      return "Updates gibt es nur in der installierten App.";
    case "checking":
      return "Suche nach Updates…";
    case "uptodate":
      return "Du hast die neueste Version.";
    case "available":
      return `Version ${u.version} ist verfügbar.`;
    case "downloading":
      return `Lade Version ${u.version}…`;
    case "ready":
      return `Version ${u.version} ist bereit.`;
    case "error":
      return "";
    default:
      return "Noch nicht geprüft.";
  }
};

const SCHRITT_LABELS: Record<string, string> = {
  uv: "Werkzeug (uv)",
  venv: "Python 3.12",
  gpu: "GPU-Erkennung",
  torch: "Torch",
  sidecar: "Pipeline-Paket",
  preload: "KI-Modelle",
};

export const SettingsView: FC<{
  initialConfig: AppConfig | null;
  version: string;
  update: UpdateState;
}> = ({ initialConfig, version, update }) => {
  const [downloadDir, setDownloadDir] = useState(
    initialConfig?.downloadDir ?? "",
  );
  const [browser, setBrowser] = useState(initialConfig?.browser ?? "edge");
  const [genreProvider, setGenreProvider] = useState(
    initialConfig?.genreProvider ?? "deezer",
  );
  const [lastfmApiKey, setLastfmApiKey] = useState(
    initialConfig?.lastfmApiKey ?? "",
  );
  const [folderLayout, setFolderLayout] = useState(
    initialConfig?.folderLayout ?? "flat",
  );
  const [downloadConcurrency, setDownloadConcurrency] = useState(
    initialConfig?.downloadConcurrency ?? 3,
  );
  const [videoQuality, setVideoQuality] = useState(
    initialConfig?.videoQuality ?? "1080",
  );
  const [saved, setSaved] = useState(false);
  const [binaries, setBinaries] = useState<BinariesStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [envInstalling, setEnvInstalling] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => {
    void window.ultrastar.binariesStatus().then(setBinaries);
    // Live-Updates (z.B. nach Erststart-Auto-Install im Main-Prozess)
    return window.ultrastar.on("event:binariesStatus", setBinaries);
  }, []);

  useEffect(() => {
    void window.ultrastar.environmentStatus().then(setEnv);
    return window.ultrastar.on("event:environmentStatus", setEnv);
  }, []);

  const binariesProgress = useIpcEvent("event:binariesProgress", null);
  const envProgress = useIpcEvent("event:environmentProgress", null);

  const choose = async (): Promise<void> => {
    const dir = await window.ultrastar.chooseDirectory();
    if (dir) setDownloadDir(dir);
  };

  const save = async (): Promise<void> => {
    await window.ultrastar.settingsSave({
      downloadDir,
      browser,
      genreProvider,
      lastfmApiKey: lastfmApiKey || undefined,
      folderLayout,
      downloadConcurrency,
      videoQuality,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const install = async (force: boolean): Promise<void> => {
    setInstalling(true);
    setInstallError(null);
    try {
      await window.ultrastar.binariesInstall(force);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const envInstall = async (force: boolean): Promise<void> => {
    setEnvInstalling(true);
    setEnvError(null);
    try {
      setEnv(await window.ultrastar.environmentInstall(force));
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvInstalling(false);
    }
  };

  const anythingMissing =
    binaries !== null &&
    (binaries.ytDlp === "missing" || binaries.ffmpeg === "missing");
  const anythingManaged =
    binaries !== null &&
    (binaries.ytDlp === "managed" || binaries.ffmpeg === "managed");

  return (
    <div>
      <h2>Einstellungen</h2>

      <h3>Download-Ordner</h3>
      <div className="row" style={{ marginBottom: 18 }}>
        <input
          className="input"
          style={{ flex: 1, maxWidth: 520 }}
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.target.value)}
          placeholder="z.B. D:\Karaoke\songs"
        />
        <button className="btn" type="button" onClick={() => void choose()}>
          Durchsuchen…
        </button>
      </div>

      <h3>Browser für YouTube-Cookies</h3>
      <p className="muted" style={{ maxWidth: 560 }}>
        yt-dlp nutzt die Cookies dieses Browsers, um YouTube-Bot-Schutz zu
        umgehen. Du solltest dort in YouTube eingeloggt sein.
      </p>
      <select
        className="input"
        style={{ width: 240, marginBottom: 18 }}
        value={browser}
        onChange={(e) => setBrowser(e.target.value)}
      >
        {BROWSERS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      <h3>Downloads</h3>
      <label className="muted" htmlFor="folder-layout">
        Ordnerstruktur neuer Downloads
      </label>
      <select
        id="folder-layout"
        className="input"
        style={{ width: 360, display: "block", marginBottom: 4 }}
        value={folderLayout}
        onChange={(e) => setFolderLayout(e.target.value)}
      >
        <option value="flat">Artist - Titel (flach)</option>
        <option value="artist">Artist / Artist - Titel</option>
        <option value="letter">A / Artist - Titel (Anfangsbuchstabe)</option>
      </select>
      <p className="muted" style={{ marginTop: 0 }}>
        Beispiel: {downloadDir || "…"}\
        {folderLayout === "artist"
          ? "ABBA\\ABBA_-_Waterloo"
          : folderLayout === "letter"
            ? "A\\ABBA_-_Waterloo"
            : "ABBA_-_Waterloo"}
      </p>
      <div className="row" style={{ marginBottom: 18 }}>
        <label className="row-inline muted" style={{ gap: 6 }}>
          Parallele Downloads
          <select
            className="input"
            value={String(downloadConcurrency)}
            onChange={(e) => setDownloadConcurrency(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="row-inline muted" style={{ gap: 6 }}>
          Video-Qualität
          <select
            className="input"
            value={videoQuality}
            onChange={(e) => setVideoQuality(e.target.value)}
          >
            <option value="720">max. 720p</option>
            <option value="1080">max. 1080p</option>
            <option value="best">Beste verfügbare</option>
          </select>
        </label>
      </div>

      <h3>Genre-Quelle</h3>
      <p className="muted" style={{ maxWidth: 560 }}>
        Quelle für das Nachtragen fehlender Genres (Bibliothek → „Genres
        nachtragen"). Deezer braucht keinen Key.
      </p>
      <select
        className="input"
        style={{ width: 240, marginBottom: 8 }}
        value={genreProvider}
        onChange={(e) => setGenreProvider(e.target.value)}
      >
        <option value="deezer">Deezer (empfohlen)</option>
        <option value="lastfm">Last.fm (API-Key nötig)</option>
        <option value="musicbrainz">MusicBrainz (langsam, 1/s)</option>
      </select>
      {genreProvider === "lastfm" && (
        <input
          className="input"
          style={{ width: 360, display: "block", marginBottom: 8 }}
          placeholder="Last.fm API-Key"
          value={lastfmApiKey}
          onChange={(e) => setLastfmApiKey(e.target.value)}
        />
      )}

      <div className="row" style={{ marginBottom: 28 }}>
        <button
          className="btn primary"
          type="button"
          onClick={() => void save()}
        >
          Speichern
        </button>
        {saved && (
          <span className="check row-inline">
            <Check size={14} aria-hidden /> gespeichert
          </span>
        )}
      </div>

      <h3>Tools</h3>
      {binaries === null ? (
        <p className="muted">Prüfe…</p>
      ) : (
        <>
          <p>
            yt-dlp: <strong>{sourceLabel(binaries.ytDlp)}</strong> · ffmpeg:{" "}
            <strong>{sourceLabel(binaries.ffmpeg)}</strong>
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            <button
              className="btn"
              type="button"
              disabled={clearingCache}
              onClick={() => {
                setClearingCache(true);
                void window.ultrastar
                  .coversClearCache()
                  .then((r) =>
                    setCacheMessage(`${r.deletedFiles} Cover-Dateien gelöscht`),
                  )
                  .finally(() => setClearingCache(false));
              }}
            >
              <Trash2 size={14} aria-hidden />
              Cover-Cache leeren
            </button>
            {cacheMessage && <span className="muted">{cacheMessage}</span>}
          </div>
          <div className="row">
            {anythingMissing && (
              <button
                className="btn primary"
                type="button"
                disabled={installing}
                onClick={() => void install(false)}
              >
                {installing ? (
                  "Installiere…"
                ) : (
                  <>
                    <Download size={14} aria-hidden />
                    Fehlende Tools automatisch installieren
                  </>
                )}
              </button>
            )}
            {anythingManaged && (
              <button
                className="btn"
                type="button"
                disabled={installing}
                onClick={() => void install(true)}
              >
                {installing ? (
                  "Aktualisiere…"
                ) : (
                  <>
                    <RefreshCw size={14} aria-hidden />
                    Jetzt aktualisieren
                  </>
                )}
              </button>
            )}
          </div>
          {anythingMissing && (
            <p className="muted">
              Manuelle Alternative:{" "}
              <a href="https://github.com/yt-dlp/yt-dlp#installation">yt-dlp</a>{" "}
              · <a href="https://www.gyan.dev/ffmpeg/builds/">ffmpeg</a>{" "}
              installieren und in den PATH aufnehmen, dann App neu starten.
            </p>
          )}
          {binariesProgress && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">{binariesProgress.name}</span>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.round(binariesProgress.percent * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {installError && <div className="error-banner">{installError}</div>}
        </>
      )}

      <h3 style={{ marginTop: 28 }}>KI-Umgebung (Song-Erstellung)</h3>
      {env === null ? (
        <p className="muted">Prüfe…</p>
      ) : (
        <>
          <p>
            Status: <strong>{envLabel(env)}</strong>
          </p>
          {env.state === "broken" && env.fehler && (
            <p className="muted">Letzter Fehler: {env.fehler.detail}</p>
          )}
          <div className="row">
            {env.state !== "ready" && (
              <button
                className="btn primary"
                type="button"
                disabled={envInstalling}
                onClick={() => void envInstall(false)}
              >
                {envInstalling ? (
                  "Richte ein…"
                ) : (
                  <>
                    <Download size={14} aria-hidden />
                    {env.state === "outdated"
                      ? "Jetzt aktualisieren"
                      : env.state === "broken"
                        ? "Erneut versuchen"
                        : "KI-Umgebung einrichten (~8 GB)"}
                  </>
                )}
              </button>
            )}
            {env.state === "ready" && (
              <button
                className="btn"
                type="button"
                disabled={envInstalling}
                onClick={() => void envInstall(true)}
              >
                <RefreshCw size={14} aria-hidden />
                Neu installieren
              </button>
            )}
            {envInstalling && (
              <button
                className="btn"
                type="button"
                onClick={() => void window.ultrastar.environmentCancel()}
              >
                Abbrechen
              </button>
            )}
          </div>
          {envProgress && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">
                {SCHRITT_LABELS[envProgress.schritt] ?? envProgress.schritt}
                {envProgress.detail ? ` – ${envProgress.detail}` : ""}
              </span>
              {envProgress.prozent !== null && (
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(envProgress.prozent * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {envError && <div className="error-banner">{envError}</div>}
        </>
      )}

      <h3 style={{ marginTop: 28 }}>App</h3>
      <p className="muted">UltraStar Desktop v{version}</p>

      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn"
          type="button"
          onClick={() => void window.ultrastar.updateCheck()}
          disabled={
            update.phase === "checking" || update.phase === "downloading"
          }
        >
          <RefreshCw size={16} /> Auf Updates prüfen
        </button>
        {update.phase === "available" && (
          <button
            className="btn primary"
            type="button"
            onClick={() => void window.ultrastar.updateDownload()}
          >
            <Download size={16} /> Version {update.version} herunterladen
          </button>
        )}
        {update.phase === "ready" && (
          <button
            className="btn primary"
            type="button"
            onClick={() => void window.ultrastar.updateInstall()}
          >
            <Check size={16} /> Neu starten und installieren
          </button>
        )}
        <span className="muted">{updateLabel(update)}</span>
      </div>
      {update.phase === "downloading" && (
        <div className="row" style={{ marginTop: 8 }}>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.round(update.percent * 100)}%` }}
            />
          </div>
          <span className="muted">{Math.round(update.percent * 100)}%</span>
        </div>
      )}
      {update.phase === "error" && (
        <div className="error-banner">{update.message}</div>
      )}
    </div>
  );
};

export default SettingsView;
