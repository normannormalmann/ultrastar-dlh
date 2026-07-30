import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  installMissingBinaries,
  prependManagedBinToPath,
  resolvePlatformBinaries,
} from "./binaries.ts";
import { registerIpcHandlers } from "./ipc.ts";
import { broadcast, initializeState, state } from "./state.ts";

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#1e1e2e",
    autoHideMenuBar: true,
    // Dev-Modus: Fenster-Icon aus dem Repo; gepackt liefert die Exe das Icon
    ...(app.isPackaged
      ? {}
      : { icon: join(import.meta.dirname, "../../resources/icon.ico") }),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM-Preload benötigt sandbox:false
    },
  });

  // Externe Links im System-Browser öffnen, nicht im App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    // Plain <a href>-Klicks: Navigation unterbinden, extern öffnen
    if (url.startsWith("http")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
};

void app.whenReady().then(() => {
  registerIpcHandlers(ipcMain);
  prependManagedBinToPath();
  createWindow();
  void initializeState().then(() => {
    // Spec: fehlende Tools werden beim ersten Start automatisch geladen
    const { ytDlpAvailable, ffmpegAvailable } = state.status;
    if (
      resolvePlatformBinaries(process.platform) !== undefined &&
      (ytDlpAvailable === false || ffmpegAvailable === false)
    ) {
      void installMissingBinaries().catch((err) => {
        broadcast("event:error", {
          context: "binaries",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
