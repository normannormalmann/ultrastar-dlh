import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Entry, ZipFile } from "yauzl";
import * as yauzl from "yauzl";

const IFMT = 0o170000;
const REGULAR = 0o100000;
const DIRECTORY = 0o040000;
// Large enough for supported binary distributions, bounded before decompression.
const MAX_ENTRIES = 10_000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * MAX_FILE_BYTES;

export class UnsafeZipEntryError extends Error {
  constructor(fileName: string, reason: string) {
    super(`Refused unsafe zip entry "${fileName}": ${reason}`);
    this.name = "UnsafeZipEntryError";
  }
}

/** Names are portable: reject Windows aliases and alternate streams on every OS. */
export const assertSafeZipEntry = (
  fileName: string,
  externalFileAttributes: number,
): void => {
  const type = (externalFileAttributes >>> 16) & IFMT;
  if (type !== 0 && type !== REGULAR && type !== DIRECTORY) {
    throw new UnsafeZipEntryError(
      fileName,
      "only regular files and directories are allowed",
    );
  }
  const segments = fileName.replace(/\/$/, "").split("/");
  const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
  if (
    fileName.includes("\\") ||
    segments.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*]/.test(part) ||
        Array.from(part).some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(part) ||
        reserved.test(part),
    )
  ) {
    throw new UnsafeZipEntryError(fileName, "nonportable or escaping path");
  }
};

const existing = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

/** Walk from the filesystem root; recursive mkdir alone can follow junctions. */
const ensureDirectory = async (path: string): Promise<void> => {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const info = await existing(current);
    if (!info) await mkdir(current);
    const checked = info ?? (await lstat(current));
    if (checked.isSymbolicLink() || !checked.isDirectory()) {
      throw new UnsafeZipEntryError(
        current,
        "destination contains a symlink or non-directory",
      );
    }
  }
};

type StagedEntry = { name: string; directory: boolean };
const openZip = (archive: string): Promise<ZipFile> =>
  new Promise((accept, reject) => {
    yauzl.open(
      archive,
      {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) => (error ? reject(error) : accept(zip)),
    );
  });

const stageEntry = async (
  zip: ZipFile,
  entry: Entry,
  staging: string,
): Promise<StagedEntry> => {
  assertSafeZipEntry(entry.fileName, entry.externalFileAttributes);
  const directory = entry.fileName.endsWith("/");
  const type = (entry.externalFileAttributes >>> 16) & IFMT;
  if ((type === DIRECTORY && !directory) || entry.isEncrypted()) {
    throw new UnsafeZipEntryError(
      entry.fileName,
      "unsupported entry encoding or type",
    );
  }
  const path = join(staging, entry.fileName);
  if (directory) await ensureDirectory(path);
  else {
    await ensureDirectory(dirname(path));
    const stream = await new Promise<import("node:stream").Readable>(
      (accept, reject) => {
        zip.openReadStream(entry, (error, stream) =>
          error ? reject(error) : accept(stream),
        );
      },
    );
    // Exclusive creation in a fresh private directory; never open the final target.
    await pipeline(
      stream,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
    );
    const archivedMode = (entry.externalFileAttributes >>> 16) & 0o777;
    await chmod(path, archivedMode || 0o644);
  }
  return { name: entry.fileName, directory };
};

const stageArchive = (zip: ZipFile, staging: string): Promise<StagedEntry[]> =>
  new Promise((accept, reject) => {
    if (zip.entryCount > MAX_ENTRIES) {
      reject(new UnsafeZipEntryError("archive", "entry limit exceeded"));
      return;
    }
    let entries: StagedEntry[] = [];
    let names: ReadonlySet<string> = new Set();
    let bytes = 0;
    let pending: Promise<unknown> = Promise.resolve();
    let failed = false;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      zip.close();
      // Finish an in-flight stream before the caller removes staging.
      void pending.catch(() => undefined).then(() => reject(error));
    };
    zip.on("error", fail);
    zip.on("end", () => accept(entries));
    zip.on("entry", (entry: Entry) => {
      pending = (async () => {
        const key = entry.fileName.replace(/\/$/, "").toLowerCase();
        if (names.has(key))
          throw new UnsafeZipEntryError(entry.fileName, "duplicate entry");
        if (
          entries.length >= MAX_ENTRIES ||
          entry.uncompressedSize > MAX_FILE_BYTES ||
          bytes + entry.uncompressedSize > MAX_TOTAL_BYTES
        ) {
          throw new UnsafeZipEntryError(
            entry.fileName,
            "extraction limit exceeded",
          );
        }
        names = new Set([...names, key]);
        bytes += entry.uncompressedSize;
        entries = [...entries, await stageEntry(zip, entry, staging)];
        if (!failed) zip.readEntry();
      })();
      void pending.catch(fail);
    });
    zip.readEntry();
  });

const validateTarget = async (
  destDir: string,
  entry: StagedEntry,
): Promise<void> => {
  const target = join(destDir, entry.name);
  await ensureDirectory(entry.directory ? target : dirname(target));
  if (entry.directory) return;
  const info = await existing(target);
  if (info && (info.isSymbolicLink() || !info.isFile())) {
    throw new UnsafeZipEntryError(
      entry.name,
      "destination is not a regular file",
    );
  }
};

/**
 * Validate and decompress fully in private staging before merging. Existing regular
 * files may be replaced; symlinks/junctions are refused. Each file is renamed,
 * never opened through its final path. The multi-file merge is not atomic.
 * As with ordinary installers, the destination must not be concurrently modified
 * by another local process while installation runs.
 */
export const extractZipSafely = async (
  archivePath: string,
  destDir: string,
): Promise<void> => {
  const destination = resolve(destDir);
  await ensureDirectory(destination);
  const staging = await mkdtemp(join(dirname(destination), ".ultrastar-zip-"));
  let zip: ZipFile | undefined;
  try {
    await chmod(staging, 0o700);
    zip = await openZip(archivePath);
    const entries = await stageArchive(zip, staging);
    // Preflight every destination before publishing any file.
    for (const entry of entries) await validateTarget(destination, entry);
    for (const entry of entries) {
      await validateTarget(destination, entry);
      if (!entry.directory)
        await rename(join(staging, entry.name), join(destination, entry.name));
    }
  } finally {
    zip?.close();
    await rm(staging, { recursive: true, force: true });
  }
};
