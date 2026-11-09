import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import { decodeSongBytes, mediaInside } from "../edit/songFile.ts";
import { headerValue, parseSongTxt } from "../edit/songTxt.ts";

export type LibraryIssue = {
  file: string;
  severity: "error" | "warning";
  message: string;
};
export type LibrarySong = {
  file: string;
  songDir: string;
  artist: string;
  title: string;
};
export type LibraryReport = {
  scanned: number;
  issues: LibraryIssue[];
  duplicates: LibrarySong[][];
};

/** Never follows directory symlinks; supports flat, artist, and letter layouts. */
export const scanSongFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.toLowerCase() === "song.txt")
        files.push(path);
    }
  };
  await visit(root);
  return files.sort();
};

/** Both lexical traversal and symlink escapes are rejected, including linked media files. */
export const safeSongFile = async (
  songDir: string,
  name: string,
): Promise<string | null> => {
  const candidate = mediaInside(songDir, name);
  if (!candidate) return null;
  try {
    const [root, path] = await Promise.all([
      realpath(songDir),
      realpath(candidate),
    ]);
    const rel = relative(root, path);
    if (
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(rel)
    )
      return null;
    const info = await stat(path);
    return info.isFile() && info.size > 0 ? path : null;
  } catch {
    return null;
  }
};

export const pathKey = (path: string): string =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const duplicateKey = (text: string): string =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("de")
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();

export const inspectLibrary = (
  root: string,
  trackedDirs: string[] = [],
): Effect.Effect<LibraryReport, Error> =>
  Effect.tryPromise({
    try: async () => {
      const files = await scanSongFiles(root);
      const issues: LibraryIssue[] = [];
      const found = new Set(files.map(pathKey));
      for (const dir of trackedDirs) {
        const rel = relative(resolve(root), resolve(dir));
        const file = join(dir, "song.txt");
        if (
          rel &&
          !rel.startsWith("..") &&
          !isAbsolute(rel) &&
          !found.has(pathKey(file))
        )
          issues.push({
            file,
            severity: "error",
            message: "Erfasster Song: song.txt oder der Songordner fehlt.",
          });
      }
      const groups = new Map<string, LibrarySong[]>();
      for (const file of files) {
        const songDir = resolve(file, "..");
        const issue = (
          message: string,
          severity: LibraryIssue["severity"] = "error",
        ) => issues.push({ file, severity, message });
        try {
          const text = decodeSongBytes(await readFile(file)).text;
          if (!/^E\s*$/m.test(text)) issue("Abschlussmarkierung E fehlt.");
          const song = parseSongTxt(text);
          const artist = headerValue(song, "ARTIST")?.trim() ?? "";
          const title = headerValue(song, "TITLE")?.trim() ?? "";
          if (!artist || !title) issue("ARTIST oder TITLE fehlt.");
          const bpm = Number(
            (headerValue(song, "BPM") ?? "").replace(",", "."),
          );
          if (!Number.isFinite(bpm) || bpm <= 0)
            issue("BPM fehlt oder ist ungültig.");
          const gap = Number(
            (headerValue(song, "GAP") ?? "0").replace(",", "."),
          );
          if (!Number.isFinite(gap)) issue("GAP ist ungültig.");
          const audio = headerValue(song, "AUDIO") ?? headerValue(song, "MP3");
          if (!audio) issue("AUDIO/MP3 fehlt.");
          for (const [key, value] of [
            ["Audio", audio],
            ["Video", headerValue(song, "VIDEO")],
            ["Cover", headerValue(song, "COVER")],
            ["Hintergrund", headerValue(song, "BACKGROUND")],
          ]) {
            if (value && !(await safeSongFile(songDir, value)))
              issue(
                `${key}: Datei fehlt, ist leer oder liegt außerhalb des Songordners (${value}).`,
                key === "Audio" ? "error" : "warning",
              );
          }
          for (const [trackIndex, track] of song.tracks.entries()) {
            let end = Number.NEGATIVE_INFINITY;
            for (const [index, note] of track.notes.entries()) {
              if (
                !Number.isSafeInteger(note.beat) ||
                !Number.isSafeInteger(note.length) ||
                !Number.isSafeInteger(note.pitch) ||
                note.length <= 0
              )
                issue(
                  `Spur ${trackIndex + 1}, Note ${index + 1}: ungültige Notenwerte.`,
                );
              if (note.beat < end)
                issue(
                  `Spur ${trackIndex + 1}, Note ${index + 1}: Überlappung oder falsche Reihenfolge.`,
                );
              end = Math.max(end, note.beat + note.length);
            }
          }
          if (artist && title) {
            const key = `${duplicateKey(artist)}\0${duplicateKey(title)}`;
            const group = groups.get(key) ?? [];
            group.push({ file, songDir, artist, title });
            groups.set(key, group);
          }
        } catch (error) {
          issue(
            `Datei kann nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return {
        scanned: files.length,
        issues,
        duplicates: [...groups.values()].filter((group) => group.length > 1),
      };
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
