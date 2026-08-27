import type { FC } from "react";
import { useEffect, useState } from "react";
import type {
  AppStatus,
  EnvironmentStatus,
} from "../../shared/ipcContract.ts";
import { type Katalog, useT } from "../i18n/index.tsx";

const dotClass = (v: boolean | null): string =>
  v === null ? "dot pending" : v ? "dot ok" : "dot bad";

/**
 * The AI environment has four states, not two: "outdated" still works, it
 * just wants an update, so it gets the same yellow the other dots use while
 * their check is still running.
 */
const envDotClass = (env: EnvironmentStatus | null): string => {
  if (env === null) return "dot pending";
  if (env.state === "ready") return "dot ok";
  if (env.state === "outdated") return "dot pending";
  return "dot bad";
};

const envText = (t: Katalog, env: EnvironmentStatus | null): string => {
  const zustand = env === null ? t.nav.aiState.unknown : t.nav.aiState[env.state];
  return `${t.settings.aiEnv} - ${zustand}`;
};

export const StatusDots: FC<{ status: AppStatus }> = ({ status }) => {
  const t = useT();
  // Fetched here rather than drilled through the sidebar: nothing above this
  // component needs the value, and the main process broadcasts changes.
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  useEffect(() => {
    void window.ultrastar.environmentStatus().then(setEnv);
    return window.ultrastar.on("event:environmentStatus", setEnv);
  }, []);

  return (
    <div className="status-dots">
      <div className="status-dot" title={t.nav.usdbLogin}>
        <span className={dotClass(status.loggedIn)} /> USDB
      </div>
      <div className="status-dot" title="yt-dlp">
        <span className={dotClass(status.ytDlpAvailable)} /> yt-dlp
      </div>
      <div className="status-dot" title="ffmpeg">
        <span className={dotClass(status.ffmpegAvailable)} /> ffmpeg
      </div>
      <div className="status-dot" title={envText(t, env)}>
        <span className={envDotClass(env)} /> {t.nav.aiEnv}
      </div>
    </div>
  );
};

export default StatusDots;
