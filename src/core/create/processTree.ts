// src/core/create/processTree.ts
// Killing a sidecar means killing its children too: demucs and whisperx
// spawn worker processes that would otherwise keep running (and keep
// holding gigabytes of VRAM). Extracted from pipeline.ts so the
// long-lived worker client shares exactly the same behaviour.
import { spawn, type ChildProcess } from "node:child_process";

/**
 * Kill a child process and everything it spawned. Never throws: a failed
 * kill must not take down the parent process.
 */
export const killProcessTree = (child: ChildProcess): void => {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    // Without an error listener a failed taskkill spawn would emit an
    // unhandled "error" event and crash the parent.
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    }).on("error", () => {
      // Kill failed - there is nothing more sensible to do than to keep
      // the parent process alive.
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Both kill paths failed - the process keeps running, but the
      // parent must not crash over it.
    }
  }
};
