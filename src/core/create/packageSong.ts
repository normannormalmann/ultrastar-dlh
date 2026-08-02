// src/core/create/packageSong.ts
// The last step: turn song_data.json plus the acquired media into a
// playable UltraStar folder. The folder is finished inside the job scratch
// dir and only then moved into the library, so a crash never leaves half a
// song behind for the library scan to trip over.
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { Effect } from "effect";
import { findCover } from "../api/artwork/coverArtArchive.ts";
import { type FolderLayout, songRelativePath } from "../download/naming.ts";
import type { AcquiredMedia } from "./media.ts";
import type { SongData } from "./songData.ts";
import { renderSongTxt } from "./writeSongTxt.ts";

export type PackageError = {
  kind: "TargetNotWritable" | "MoveFailed";
  detail: string;
};

export type PackageMeta = {
  artist: string;
  title: string;
  genre?: string;
  year?: number;
  creator?: string;
};

export type PackageDeps = {
  findCoverFn?: typeof findCover;
  /** Injected so the test can make the move fail without a full disk. */
  verschiebe?: (von: string, nach: string) => Promise<void>;
};

export type PackageOptions = {
  songData: SongData;
  medien: AcquiredMedia;
  meta: PackageMeta;
  libraryDir: string;
  layout: FolderLayout;
  jobDir: string;
  deps?: PackageDeps;
};

/**
 * A free folder name next to an existing one. The user chose "put it
 * beside it" over overwriting: an existing folder may hold hand-corrected
 * note work. Consequence, stated openly: the duplicate's leaf name differs,
 * so the library's done-marker will not recognise it as the same song.
 */
export const freierZielpfad = async (
  libraryDir: string,
  relPath: string,
): Promise<{ pfad: string; dirName: string }> => {
  const teile = relPath.split("/");
  const blatt = teile.pop() as string;
  const eltern = teile.join("/");
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? blatt : `${blatt} (${n})`;
    const rel = eltern ? `${eltern}/${name}` : name;
    const pfad = join(libraryDir, rel);
    if (!existsSync(pfad)) return { pfad, dirName: name };
  }
};

/** rename fails across drives (EXDEV) - the library often lives elsewhere. */
const verschiebeStandard = async (von: string, nach: string): Promise<void> => {
  try {
    await rename(von, nach);
  } catch {
    await cp(von, nach, { recursive: true });
    await rm(von, { recursive: true, force: true });
  }
};

export const assemblePackage = (
  opts: PackageOptions,
): Effect.Effect<
  { songDir: string; dirName: string; warnungen: string[] },
  PackageError
> =>
  Effect.gen(function* () {
    const warnungen: string[] = [];
    const findCoverFn = opts.deps?.findCoverFn ?? findCover;
    const verschiebe = opts.deps?.verschiebe ?? verschiebeStandard;
    const rohbau = join(opts.jobDir, "paket");

    // The Cover Art Archive outranks the thumbnail: a real album cover is
    // square and unlettered, a video thumbnail is neither.
    const gefunden = yield* findCoverFn(opts.meta.artist, opts.meta.title);
    const hatCover = gefunden !== null || opts.medien.coverKandidat !== undefined;
    if (!hatCover) warnungen.push("Kein Cover gefunden - Paket ohne Bild.");

    const mediendatei = opts.medien.videoPath
      ? "video.mp4"
      : `audio${extname(opts.medien.audioPath) || ".mp3"}`;

    yield* Effect.tryPromise({
      try: async () => {
        await rm(rohbau, { recursive: true, force: true });
        await mkdir(rohbau, { recursive: true });
        await copyFile(
          opts.medien.videoPath ?? opts.medien.audioPath,
          join(rohbau, mediendatei),
        );
        if (gefunden) {
          await writeFile(join(rohbau, "cover.jpg"), gefunden);
        } else if (opts.medien.coverKandidat) {
          await copyFile(opts.medien.coverKandidat, join(rohbau, "cover.jpg"));
        }
        const txt = renderSongTxt(opts.songData, {
          artist: opts.meta.artist,
          title: opts.meta.title,
          mp3: mediendatei,
          genre: opts.meta.genre,
          year: opts.meta.year,
          creator: opts.meta.creator,
          cover: hatCover ? "cover.jpg" : undefined,
          video: opts.medien.videoPath ? mediendatei : undefined,
        });
        await writeFile(join(rohbau, "song.txt"), txt, "utf8");
      },
      catch: (e): PackageError => ({
        kind: "TargetNotWritable",
        detail: e instanceof Error ? e.message : String(e),
      }),
    });

    const relPath = songRelativePath(
      opts.meta.artist,
      opts.meta.title,
      opts.layout,
    );
    const ziel = yield* Effect.tryPromise({
      try: async () => {
        const frei = await freierZielpfad(opts.libraryDir, relPath);
        await mkdir(dirname(frei.pfad), { recursive: true });
        return frei;
      },
      catch: (e): PackageError => ({
        kind: "TargetNotWritable",
        detail: e instanceof Error ? e.message : String(e),
      }),
    });

    yield* Effect.tryPromise({
      try: () => verschiebe(rohbau, ziel.pfad),
      catch: (e): PackageError => ({
        kind: "MoveFailed",
        detail: e instanceof Error ? e.message : String(e),
      }),
    });

    return { songDir: ziel.pfad, dirName: ziel.dirName, warnungen };
  });
