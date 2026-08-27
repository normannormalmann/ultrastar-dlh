// src/desktop/renderer/i18n/es.ts
import type { Katalog } from "./index.tsx";

export const es: Katalog = {
  app: {
    initialising: "Inicializando…",
  },
  nav: {
    search: "Buscar",
    create: "Crear",
    queue: "Cola",
    downloaded: "Descargadas",
    repair: "Reparación",
    settings: "Ajustes",
    usdbLogin: "Sesión en USDB",
  },
  downloads: {
    done: "listo",
  },
  creation: {
    details: "Detalles",
    remove: "Quitar",
    openFolder: "Abrir carpeta",
    lowConfidence:
      "La sincronización no es fiable — el reconocimiento fue dudoso en varios puntos. El editor de corrección lo arreglará más adelante.",
    stage: {
      loadModels: "cargando modelos",
      beschaffen: "obteniendo",
      separate: "separando",
      transcribe: "transcribiendo",
      align: "alineando",
      pitch: "tono",
      tempo: "tempo",
      notes: "notas",
      paket: "montando paquete",
    },
    status: {
      queued: "en espera",
      running: "en curso",
      completed: "lista",
      failed: "fallida",
      cancelled: "cancelada",
    },
  },
  repair: {
    title: "Reparación de vídeos",
    intro:
      "Recorre la carpeta de descargas en busca de canciones con un video.mp4 ausente o dañado y vuelve a descargar esos vídeos. Las canciones sin registro de seguimiento se reconstruyen por el camino.",
    scanRunning: "Analizando…",
    startScan: "Iniciar análisis",
    done: "¡Listo!",
    repaired: "Reparadas:",
    trackingRebuilt: (n: number) => `seguimiento reconstruido: ${n}`,
    unrepairable: (n: number) => `Irreparables (${n}):`,
    andMore: (n: number) => `… y ${n} más`,
  },
  settings: {
    language: "Idioma",
  },
};
