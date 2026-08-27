// src/desktop/renderer/i18n/en.ts
import type { Katalog } from "./index.tsx";

export const en: Katalog = {
  app: {
    initialising: "Starting up…",
  },
  nav: {
    search: "Search",
    create: "Create",
    queue: "Queue",
    downloaded: "Downloaded",
    repair: "Repair",
    settings: "Settings",
    usdbLogin: "USDB login",
  },
  downloads: {
    done: "done",
  },
  creation: {
    details: "Details",
    remove: "Remove",
    openFolder: "Open folder",
    lowConfidence:
      "The sync is uncertain — the detection was inconclusive in several places. The correction editor will straighten this out later.",
    stage: {
      loadModels: "loading models",
      beschaffen: "fetching",
      separate: "separating",
      transcribe: "transcribing",
      align: "aligning",
      pitch: "pitch",
      tempo: "tempo",
      notes: "notes",
      paket: "building package",
    },
    status: {
      queued: "waiting",
      running: "running",
      completed: "done",
      failed: "failed",
      cancelled: "cancelled",
    },
  },
  repair: {
    title: "Video repair",
    intro:
      "Scans the download folder for songs with a missing or broken video.mp4 and downloads those videos again. Songs without a tracking entry are reconstructed along the way.",
    scanRunning: "Scanning…",
    startScan: "Start scan",
    done: "Done!",
    repaired: "Repaired:",
    trackingRebuilt: (n: number) => `tracking reconstructed: ${n}`,
    unrepairable: (n: number) => `Beyond repair (${n}):`,
    andMore: (n: number) => `… and ${n} more`,
  },
  settings: {
    language: "Language",
  },
};
