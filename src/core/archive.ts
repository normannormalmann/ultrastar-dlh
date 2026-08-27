// src/core/archive.ts
// Zip extraction with the guard extract-zip lacks. extract-zip happily
// turns an archive entry into a symlink, so a crafted archive can point one
// entry outside the destination and have every later entry written through
// it (GHSA-jmr9-qjv8-65gv). The advisory has no fix: 2.0.1 is the last
// release. Every archive this app unpacks - uv, yt-dlp, ffmpeg - is a plain
// file list, so refusing symlinks and climbing names costs us nothing.

/** Mask that isolates the file-type bits of a unix mode. */
const IFMT = 0o170000;
/** File-type bits of a symbolic link. */
const IFLNK = 0o120000;

/** Raised for an archive entry that must not be written to disk. */
export class UnsafeZipEntryError extends Error {
  constructor(fileName: string, grund: string) {
    super(`Refused unsafe zip entry "${fileName}": ${grund}`);
    this.name = "UnsafeZipEntryError";
  }
}

/**
 * Throw unless the entry is a plain file or directory inside the
 * destination. Thrown from extract-zip's onEntry, which aborts the whole
 * extraction and rejects - nothing of the archive is left half-written.
 *
 * @param fileName entry name as stored in the archive
 * @param externalFileAttributes zip's attribute word; its high half is the unix mode
 */
export const assertSafeZipEntry = (
  fileName: string,
  externalFileAttributes: number,
): void => {
  const mode = (externalFileAttributes >> 16) & 0xffff;
  if ((mode & IFMT) === IFLNK) {
    throw new UnsafeZipEntryError(fileName, "symlinks are not allowed");
  }

  // Zip names use forward slashes; a backslash is either a literal filename
  // character (which we do not need) or an attempt to dodge a "/" check.
  const segments = fileName.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new UnsafeZipEntryError(fileName, "path climbs out of the destination");
  }
  // A leading "/" or a drive letter would make path.join ignore the
  // destination entirely.
  if (segments[0] === "" || /^[a-zA-Z]:$/.test(segments[0] ?? "")) {
    throw new UnsafeZipEntryError(fileName, "absolute paths are not allowed");
  }
};

/**
 * Extract a zip archive into destDir, refusing entries that could escape it.
 * Plain async rather than Effect, matching both callers (desktop binaries
 * install and the managed sidecar environment).
 */
export const extractZipSafely = async (
  archivePath: string,
  destDir: string,
): Promise<void> => {
  const extractZip = (await import("extract-zip")).default;
  await extractZip(archivePath, {
    dir: destDir,
    onEntry: (entry) =>
      assertSafeZipEntry(entry.fileName, entry.externalFileAttributes),
  });
};
