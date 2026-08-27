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
import {
  aufloesenSprache,
  type Katalog,
  type Sprache,
  SPRACH_NAMEN,
  SPRACHEN,
  useSprache,
  useT,
} from "../i18n/index.tsx";

const BROWSERS = [
  "edge",
  "chrome",
  "firefox",
  "brave",
  "chromium",
  "opera",
  "vivaldi",
] as const;

const sourceLabel = (t: Katalog, s: "system" | "managed" | "missing"): string =>
  s === "system"
    ? t.settings.sourceSystem
    : s === "managed"
      ? t.settings.sourceManaged
      : t.settings.sourceMissing;

const envLabel = (t: Katalog, s: EnvironmentStatus): string =>
  s.state === "ready"
    ? t.settings.envReady(
        s.torchVariante === "cu128" ? "GPU" : "CPU",
        s.pythonVersion ?? "?",
      )
    : s.state === "outdated"
      ? t.settings.envOutdated
      : s.state === "broken"
        ? t.settings.envBroken(s.fehler?.schritt ?? "?")
        : t.settings.envMissing;

const updateLabel = (t: Katalog, u: UpdateState): string => {
  switch (u.phase) {
    case "disabled":
      return t.settings.updateDisabled;
    case "checking":
      return t.settings.updateChecking;
    case "uptodate":
      return t.settings.updateUptodate;
    case "available":
      return t.settings.updateAvailable(u.version);
    case "downloading":
      return t.settings.updateDownloading(u.version);
    case "ready":
      return t.settings.updateReady(u.version);
    case "error":
      return "";
    default:
      return t.settings.updateNotChecked;
  }
};

export const SettingsView: FC<{
  initialConfig: AppConfig | null;
  version: string;
  update: UpdateState;
  /** Applies the picked language immediately, before the config is saved. */
  onSprache: (s: Sprache) => void;
}> = ({ initialConfig, version, update, onSprache }) => {
  const t = useT();
  const sprache = useSprache();
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
      uiLanguage: sprache,
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

  const beispielPfad = `${downloadDir || "…"}\\${
    folderLayout === "artist"
      ? "ABBA\\ABBA_-_Waterloo"
      : folderLayout === "letter"
        ? "A\\ABBA_-_Waterloo"
        : "ABBA_-_Waterloo"
  }`;

  return (
    <div>
      <h2>{t.settings.title}</h2>

      <h3>{t.settings.downloadFolder}</h3>
      <div className="row" style={{ marginBottom: 18 }}>
        <input
          className="input"
          style={{ flex: 1, maxWidth: 520 }}
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.target.value)}
          placeholder={t.settings.pathPlaceholder}
        />
        <button className="btn" type="button" onClick={() => void choose()}>
          {t.settings.browse}
        </button>
      </div>

      <h3>{t.settings.cookieBrowser}</h3>
      <p className="muted" style={{ maxWidth: 560 }}>
        {t.settings.cookieBrowserHint}
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

      <h3>{t.settings.downloads}</h3>
      <label className="muted" htmlFor="folder-layout">
        {t.settings.folderLayoutLabel}
      </label>
      <select
        id="folder-layout"
        className="input"
        style={{ width: 360, display: "block", marginBottom: 4 }}
        value={folderLayout}
        onChange={(e) => setFolderLayout(e.target.value)}
      >
        <option value="flat">{t.settings.layoutFlat}</option>
        <option value="artist">{t.settings.layoutArtist}</option>
        <option value="letter">{t.settings.layoutLetter}</option>
      </select>
      <p className="muted" style={{ marginTop: 0 }}>
        {t.settings.example(beispielPfad)}
      </p>
      <div className="row" style={{ marginBottom: 18 }}>
        <label className="row-inline muted" style={{ gap: 6 }}>
          {t.settings.parallelDownloads}
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
          {t.settings.videoQuality}
          <select
            className="input"
            value={videoQuality}
            onChange={(e) => setVideoQuality(e.target.value)}
          >
            <option value="720">{t.settings.quality720}</option>
            <option value="1080">{t.settings.quality1080}</option>
            <option value="best">{t.settings.qualityBest}</option>
          </select>
        </label>
      </div>

      <h3>{t.settings.genreSource}</h3>
      <p className="muted" style={{ maxWidth: 560 }}>
        {t.settings.genreSourceHint}
      </p>
      <select
        className="input"
        style={{ width: 240, marginBottom: 8 }}
        value={genreProvider}
        onChange={(e) => setGenreProvider(e.target.value)}
      >
        <option value="deezer">{t.settings.providerDeezer}</option>
        <option value="lastfm">{t.settings.providerLastfm}</option>
        <option value="musicbrainz">{t.settings.providerMusicbrainz}</option>
      </select>
      {genreProvider === "lastfm" && (
        <input
          className="input"
          style={{ width: 360, display: "block", marginBottom: 8 }}
          placeholder={t.settings.lastfmKeyPlaceholder}
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
          {t.settings.save}
        </button>
        {saved && (
          <span className="check row-inline">
            <Check size={14} aria-hidden /> {t.settings.saved}
          </span>
        )}
      </div>

      <h3>{t.settings.tools}</h3>
      {binaries === null ? (
        <p className="muted">{t.settings.checking}</p>
      ) : (
        <>
          <p>
            yt-dlp: <strong>{sourceLabel(t, binaries.ytDlp)}</strong> ·{" "}
            ffmpeg: <strong>{sourceLabel(t, binaries.ffmpeg)}</strong>
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
                    setCacheMessage(t.settings.coversDeleted(r.deletedFiles)),
                  )
                  .finally(() => setClearingCache(false));
              }}
            >
              <Trash2 size={14} aria-hidden />
              {t.settings.clearCoverCache}
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
                  t.settings.installing
                ) : (
                  <>
                    <Download size={14} aria-hidden />
                    {t.settings.installMissingTools}
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
                  t.settings.updating
                ) : (
                  <>
                    <RefreshCw size={14} aria-hidden />
                    {t.settings.updateNow}
                  </>
                )}
              </button>
            )}
          </div>
          {anythingMissing && (
            <p className="muted">
              {t.settings.manualBefore}
              <a href="https://github.com/yt-dlp/yt-dlp#installation">yt-dlp</a> ·{" "}
              <a href="https://www.gyan.dev/ffmpeg/builds/">ffmpeg</a>
              {t.settings.manualAfter}
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

      <h3 style={{ marginTop: 28 }}>{t.settings.aiEnv}</h3>
      {env === null ? (
        <p className="muted">{t.settings.checking}</p>
      ) : (
        <>
          <p>
            {t.settings.statusLabel} <strong>{envLabel(t, env)}</strong>
          </p>
          {env.state === "broken" && env.fehler && (
            <p className="muted">{t.settings.lastError(env.fehler.detail)}</p>
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
                  t.settings.settingUp
                ) : (
                  <>
                    <Download size={14} aria-hidden />
                    {env.state === "outdated"
                      ? t.settings.updateNow
                      : env.state === "broken"
                        ? t.settings.retry
                        : t.settings.setupAiEnv}
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
                {t.settings.reinstall}
              </button>
            )}
            {envInstalling && (
              <button
                className="btn"
                type="button"
                onClick={() => void window.ultrastar.environmentCancel()}
              >
                {t.settings.cancel}
              </button>
            )}
          </div>
          {envProgress && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">
                {(t.settings.step as Record<string, string>)[
                  envProgress.schritt
                ] ?? envProgress.schritt}
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

      <h3 style={{ marginTop: 28 }}>{t.settings.language}</h3>
      <div className="row">
        <select
          value={sprache}
          onChange={(e) => onSprache(aufloesenSprache(e.target.value))}
        >
          {SPRACHEN.map((code) => (
            <option key={code} value={code}>
              {SPRACH_NAMEN[code]}
            </option>
          ))}
        </select>
      </div>

      <h3 style={{ marginTop: 28 }}>{t.settings.app}</h3>
      <p className="muted">{t.settings.appVersion(version)}</p>

      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn"
          type="button"
          onClick={() => void window.ultrastar.updateCheck()}
          disabled={
            update.phase === "checking" || update.phase === "downloading"
          }
        >
          <RefreshCw size={16} /> {t.settings.checkUpdates}
        </button>
        {update.phase === "available" && (
          <button
            className="btn primary"
            type="button"
            onClick={() => void window.ultrastar.updateDownload()}
          >
            <Download size={16} /> {t.settings.downloadVersion(update.version)}
          </button>
        )}
        {update.phase === "ready" && (
          <button
            className="btn primary"
            type="button"
            onClick={() => void window.ultrastar.updateInstall()}
          >
            <Check size={16} /> {t.settings.restartAndInstall}
          </button>
        )}
        <span className="muted">{updateLabel(t, update)}</span>
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
