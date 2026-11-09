// src/desktop/main/editor.ts
// IPC side of the correction editor. Results travel as { ok, error.code }
// rather than thrown errors: ipcMain.handle flattens a rejection into a
// message string, and the renderer needs the code to say it in its language.
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, join } from "node:path";
import { Effect, Either } from "effect";
import { loadSongForEdit, saveEditedSong } from "../../core/edit/songFile.ts";
import type {
  EditorLoadResult,
  EditorSaveRequest,
  EditorSaveResult,
} from "../shared/ipcContract.ts";
import { safeSongFile } from "../../core/library/inspect.ts";
import {
  ORIGINAL_PITCH_FILE,
  VOCALS_FILE,
  parseOriginalPitch,
} from "../../core/edit/originalVocal.ts";
import { serializeFile } from "../../core/storage/atomicFile.ts";
import { registerMedia } from "./editorMedia.ts";

/**
 * The renderer names the folder. Only folders inside the library are
 * opened, so the editor can not be talked into rewriting some other .txt.
 */
export const insideLibrary = (
  libraryDir: string,
  songDir: unknown,
): songDir is string => {
  if (typeof songDir !== "string" || songDir.trim() === "" || !libraryDir) {
    return false;
  }
  const rel = relative(resolve(libraryDir), resolve(songDir));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * insideLibrary on the resolved paths: a junction or symlink inside the
 * library would otherwise lead the editor to a folder anywhere on disk.
 * Returns the real folder to work in, or null.
 */
export const realSongDir = async (
  libraryDir: string,
  songDir: unknown,
): Promise<string | null> => {
  if (!insideLibrary(libraryDir, songDir)) return null;
  try {
    const [bibliothek, ordner] = await Promise.all([
      realpath(libraryDir),
      realpath(songDir),
    ]);
    return insideLibrary(bibliothek, ordner) ? ordner : null;
  } catch {
    return null;
  }
};

export const loadForEditor = async (
  libraryDir: string,
  songDir: unknown,
): Promise<EditorLoadResult> => {
  const ordner = await realSongDir(libraryDir, songDir);
  if (ordner === null) {
    return { ok: false, error: { code: "outsideLibrary" } };
  }
  if (!(await safeSongFile(ordner, "song.txt")))
    return { ok: false, error: { code: "notFound" } };
  const ergebnis = await Effect.runPromise(
    Effect.either(loadSongForEdit(ordner, existsSync)),
  );
  if (Either.isLeft(ergebnis)) return { ok: false, error: ergebnis.left };
  const { song, revision, audioPath, converted } = ergebnis.right;
  const safeAudio = audioPath
    ? await safeSongFile(ordner, relative(ordner, audioPath))
    : null;
  const trace = await safeSongFile(ordner, ORIGINAL_PITCH_FILE);
  const originalPitch =
    trace && (await stat(trace)).size < 32_000_000
      ? await readFile(trace, "utf8")
          .then((text) => parseOriginalPitch(JSON.parse(text)))
          .catch(() => null)
      : null;
  const vocals = await safeSongFile(
    ordner,
    originalPitch?.vocalFile ?? VOCALS_FILE,
  );
  return {
    originalPitch,
    vocalUrl: vocals ? registerMedia(vocals) : null,
    ok: true,
    song,
    revision,
    converted,
    mediaUrl: safeAudio === null ? null : registerMedia(safeAudio),
  };
};

export const saveFromEditor = async (
  libraryDir: string,
  req: EditorSaveRequest,
): Promise<EditorSaveResult> => {
  const ordner = await realSongDir(libraryDir, req?.songDir);
  if (ordner === null || typeof req.revision !== "string") {
    return { ok: false, error: { code: "outsideLibrary" } };
  }
  if (!(await safeSongFile(ordner, "song.txt")))
    return { ok: false, error: { code: "notFound" } };
  const ergebnis = await serializeFile(join(ordner, "song.txt"), () =>
    Effect.runPromise(
      Effect.either(saveEditedSong(ordner, req.song, req.revision)),
    ),
  );
  return Either.isLeft(ergebnis)
    ? { ok: false, error: ergebnis.left }
    : { ok: true, revision: ergebnis.right.revision };
};
