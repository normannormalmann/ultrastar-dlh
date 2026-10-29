// src/desktop/main/editor.ts
// IPC side of the correction editor. Results travel as { ok, error.code }
// rather than thrown errors: ipcMain.handle flattens a rejection into a
// message string, and the renderer needs the code to say it in its language.
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Effect, Either } from "effect";
import { loadSongForEdit, saveEditedSong } from "../../core/edit/songFile.ts";
import type {
  EditorLoadResult,
  EditorSaveRequest,
  EditorSaveResult,
} from "../shared/ipcContract.ts";
import { registerMedia } from "./editorMedia.ts";

/**
 * The renderer names the folder. Only folders inside the library are
 * opened, so the editor can not be talked into rewriting some other .txt.
 */
export const insideLibrary = (libraryDir: string, songDir: unknown): songDir is string => {
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
  const ergebnis = await Effect.runPromise(
    Effect.either(loadSongForEdit(ordner, existsSync)),
  );
  if (Either.isLeft(ergebnis)) return { ok: false, error: ergebnis.left };
  const { song, revision, audioPath, converted } = ergebnis.right;
  return {
    ok: true,
    song,
    revision,
    converted,
    mediaUrl: audioPath === null ? null : registerMedia(audioPath),
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
  const ergebnis = await Effect.runPromise(
    Effect.either(saveEditedSong(ordner, req.song, req.revision)),
  );
  return Either.isLeft(ergebnis)
    ? { ok: false, error: ergebnis.left }
    : { ok: true, revision: ergebnis.right.revision };
};
