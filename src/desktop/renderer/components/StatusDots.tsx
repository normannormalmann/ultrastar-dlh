import type { FC } from "react";
import type { AppStatus } from "../../shared/ipcContract.ts";

const dotClass = (v: boolean | null): string =>
  v === null ? "dot pending" : v ? "dot ok" : "dot bad";

export const StatusDots: FC<{ status: AppStatus }> = ({ status }) => (
  <div className="status-dots">
    <div className="status-dot" title="USDB-Login">
      <span className={dotClass(status.loggedIn)} /> USDB
    </div>
    <div className="status-dot" title="yt-dlp">
      <span className={dotClass(status.ytDlpAvailable)} /> yt-dlp
    </div>
    <div className="status-dot" title="ffmpeg">
      <span className={dotClass(status.ffmpegAvailable)} /> ffmpeg
    </div>
  </div>
);

export default StatusDots;
