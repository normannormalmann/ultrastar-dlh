import { existsSync } from "node:fs";
import { relative } from "node:path";
import { Effect } from "effect";
import { analyzeOriginalVocal } from "../../core/create/vocalAnalysis.ts";
import {
  envPythonBin,
  sidecarFingerprint,
} from "../../core/create/environment.ts";
import { loadSongForEdit } from "../../core/edit/songFile.ts";
import { safeSongFile } from "../../core/library/inspect.ts";
import { realSongDir, loadForEditor } from "./editor.ts";
import {
  creationWorkDir,
  environmentStatusForApp,
  managedEnvDir,
  sidecarDir,
} from "./environment.ts";
import { broadcast } from "./state.ts";

let active: {
  folder: string;
  controller: AbortController;
  done: Promise<unknown>;
} | null = null;
export const vocalAnalysisRunning = () => active !== null;
export const cancelVocalAnalysis = (folder?: string) => {
  if (!folder || active?.folder === folder) active?.controller.abort();
};
export const shutdownVocalAnalysis = async () => {
  cancelVocalAnalysis();
  await active?.done.catch(() => {});
};

export const analyzeForEditor = (
  library: string,
  folder: string,
  midiOffset: 48 | 60,
  prepare: () => Promise<void>,
) => {
  if (active) throw new Error("Eine Gesangsanalyse läuft bereits.");
  const controller = new AbortController();
  const done = (async () => {
    try {
      await prepare();
      const real = await realSongDir(library, folder);
      if (!real || !(await safeSongFile(real, "song.txt")))
        throw new Error("Ungültiger Songordner.");
      if ((await environmentStatusForApp()).state !== "ready")
        throw new Error(
          "Bitte die KI-Umgebung in den Einstellungen einrichten oder aktualisieren.",
        );
      const song = await Effect.runPromise(loadSongForEdit(real, existsSync));
      const audio = song.audioPath
        ? await safeSongFile(real, relative(real, song.audioPath))
        : null;
      if (!audio) throw new Error("Keine Audiodatei für die Analyse gefunden.");
      await Effect.runPromise(
        analyzeOriginalVocal({
          songDir: real,
          audioPath: audio,
          midiOffset,
          python: envPythonBin(managedEnvDir()),
          workDir: creationWorkDir(),
          analysisVersion: await sidecarFingerprint(sidecarDir()),
          signal: controller.signal,
          onProgress: (stage, percent) =>
            broadcast("event:vocalAnalysis", {
              songDir: folder,
              stage,
              percent,
            }),
        }),
      );
      return await loadForEditor(library, folder);
    } finally {
      active = null;
      broadcast("event:vocalAnalysis", null);
    }
  })();
  active = { folder, controller, done };
  return done;
};
