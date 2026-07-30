import type { FC } from "react";
import { useEffect, useState } from "react";
import type { AppError, InitialState } from "../shared/ipcContract.ts";
import DownloadBar from "./components/DownloadBar.tsx";
import Sidebar, { type ViewId } from "./components/Sidebar.tsx";
import { useIpcEvent } from "./hooks.ts";
import DownloadedView from "./views/DownloadedView.tsx";
import QueueView from "./views/QueueView.tsx";
import RepairView from "./views/RepairView.tsx";
import SearchView from "./views/SearchView.tsx";
import SettingsView from "./views/SettingsView.tsx";

const ERROR_DISPLAY_MS = 6000;

/**
 * Outer component: only loads the initial state. The shell is only mounted
 * afterwards, so the useIpcEvent hooks start with the correct initial values
 * (hook initial values are only picked up on the first render).
 */
export const App: FC = () => {
  const [initial, setInitial] = useState<InitialState | null>(null);

  useEffect(() => {
    void window.ultrastar.getInitialState().then(setInitial);
  }, []);

  if (!initial) {
    return (
      <div className="app-shell">
        <div className="main-view muted">Initialisiere…</div>
      </div>
    );
  }
  return <Shell initial={initial} />;
};

const Shell: FC<{ initial: InitialState }> = ({ initial }) => {
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

  return (
    <div className="app-shell">
      <Sidebar
        active={view}
        onSelect={setView}
        queueCount={queue.length}
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
        {view === "queue" && <QueueView queue={queue} />}
        {view === "downloaded" && <DownloadedView entries={downloaded} />}
        {view === "repair" && <RepairView status={status} />}
        {view === "settings" && (
          <SettingsView
            initialConfig={initial.config}
            version={initial.version}
          />
        )}
      </main>
      <DownloadBar downloads={downloads} />
    </div>
  );
};

export default App;
