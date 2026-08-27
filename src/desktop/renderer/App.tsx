import type { FC } from "react";
import { useEffect, useState } from "react";
import type { AppError, InitialState } from "../shared/ipcContract.ts";
import DownloadBar from "./components/DownloadBar.tsx";
import Sidebar, { type ViewId } from "./components/Sidebar.tsx";
import { useIpcEvent } from "./hooks.ts";
import {
  aufloesenSprache,
  type Sprache,
  SpracheProvider,
  useT,
} from "./i18n/index.tsx";
import CreateView from "./views/CreateView.tsx";
import { type Entwurf, leererEntwurf } from "./views/createDraft.ts";
import DownloadedView from "./views/DownloadedView.tsx";
import QueueView from "./views/QueueView.tsx";
import RepairView from "./views/RepairView.tsx";
import SearchView from "./views/SearchView.tsx";
import SettingsView from "./views/SettingsView.tsx";

const ERROR_DISPLAY_MS = 6000;

/** Inside the provider, so it speaks the same language as the rest. */
const Ladeanzeige: FC = () => {
  const t = useT();
  return (
    <div className="app-shell">
      <div className="main-view muted">{t.app.initialising}</div>
    </div>
  );
};

/**
 * Outer component: only loads the initial state. The shell is only mounted
 * afterwards, so the useIpcEvent hooks start with the correct initial values
 * (hook initial values are only picked up on the first render).
 */
export const App: FC = () => {
  const [initial, setInitial] = useState<InitialState | null>(null);
  // Until the config is in, the system language is the best guess; it only
  // ever changes here through the settings picker.
  const [sprache, setSprache] = useState<Sprache>(() =>
    aufloesenSprache(undefined),
  );

  useEffect(() => {
    void window.ultrastar.getInitialState().then((s) => {
      setSprache(aufloesenSprache(s.config?.uiLanguage));
      setInitial(s);
    });
  }, []);

  return (
    <SpracheProvider sprache={sprache}>
      {initial ? (
        <Shell initial={initial} onSprache={setSprache} />
      ) : (
        <Ladeanzeige />
      )}
    </SpracheProvider>
  );
};

const Shell: FC<{
  initial: InitialState;
  onSprache: (s: Sprache) => void;
}> = ({ initial, onSprache }) => {
  const [view, setView] = useState<ViewId>("search");
  const [lastError, setLastError] = useState<AppError | null>(null);

  useEffect(
    () =>
      window.ultrastar.on("event:error", (err) => {
        setLastError(err);
        setTimeout(() => setLastError(null), ERROR_DISPLAY_MS);
      }),
    [],
  );

  const status = useIpcEvent("event:status", initial.status);
  const queue = useIpcEvent("event:queueChanged", initial.queue);
  const downloads = useIpcEvent("event:activeDownloads", []);
  const downloaded = useIpcEvent("event:downloadedChanged", initial.downloaded);
  // Startwert aus dem Initialzustand: eine wiederhergestellte Queue meldet
  // sich, bevor dieser Hook zuhoert.
  const creations = useIpcEvent("event:creations", initial.creations);
  const update = useIpcEvent("event:update", initial.update);
  const [entwurf, setEntwurf] = useState<Entwurf>(() =>
    leererEntwurf(crypto.randomUUID()),
  );

  return (
    <div className="app-shell">
      <Sidebar
        active={view}
        onSelect={setView}
        queueCount={queue.length}
        creationCount={creations.filter((c) => c.status === "queued").length}
        status={status}
      />
      <main className="main-view">
        {lastError && (
          <div className="error-banner">
            [{lastError.context}] {lastError.message}
          </div>
        )}
        {view === "search" && (
          <SearchView downloaded={downloaded} status={status} />
        )}
        {view === "create" && (
          <CreateView
            entwurf={entwurf}
            setEntwurf={setEntwurf}
            downloaded={downloaded}
          />
        )}
        {view === "queue" && <QueueView queue={queue} creations={creations} />}
        {view === "downloaded" && <DownloadedView entries={downloaded} />}
        {view === "repair" && <RepairView status={status} />}
        {view === "settings" && (
          <SettingsView
            initialConfig={initial.config}
            version={initial.version}
            update={update}
            onSprache={onSprache}
          />
        )}
      </main>
      <DownloadBar downloads={downloads} />
    </div>
  );
};

export default App;
