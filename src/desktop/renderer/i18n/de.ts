// src/desktop/renderer/i18n/de.ts
// Source of truth: the shape inferred here types the English and Spanish
// catalogs, so a key that exists only in German fails to compile.
export const de = {
  app: {
    initialising: "Initialisiere…",
  },
  nav: {
    search: "Suche",
    create: "Erstellen",
    queue: "Queue",
    downloaded: "Heruntergeladen",
    repair: "Reparatur",
    settings: "Einstellungen",
    usdbLogin: "USDB-Login",
  },
  downloads: {
    done: "fertig",
  },
  creation: {
    details: "Details",
    remove: "Entfernen",
    openFolder: "Ordner öffnen",
    lowConfidence:
      "Der Sync ist unsicher — die Erkennung war an mehreren Stellen unschlüssig. Der Korrektur-Editor zieht das später gerade.",
    stage: {
      loadModels: "Modelle laden",
      beschaffen: "beschaffen",
      separate: "trennen",
      transcribe: "erkennen",
      align: "ausrichten",
      pitch: "Tonhöhe",
      tempo: "Tempo",
      notes: "Noten",
      paket: "Paket bauen",
    },
    status: {
      queued: "wartet",
      running: "läuft",
      completed: "fertig",
      failed: "fehlgeschlagen",
      cancelled: "abgebrochen",
    },
  },
  repair: {
    title: "Video-Reparatur",
    intro:
      "Durchsucht den Download-Ordner nach Songs mit fehlendem oder defektem video.mp4 und lädt die Videos erneut herunter. Songs ohne Tracking-Eintrag werden dabei rekonstruiert.",
    scanRunning: "Scan läuft…",
    startScan: "Scan starten",
    done: "Fertig!",
    repaired: "Repariert:",
    trackingRebuilt: (n: number) => `Tracking rekonstruiert: ${n}`,
    unrepairable: (n: number) => `Nicht reparierbar (${n}):`,
    andMore: (n: number) => `… und ${n} weitere`,
  },
  settings: {
    language: "Sprache",
  },
};
