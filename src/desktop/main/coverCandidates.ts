// src/desktop/main/coverCandidates.ts
// Step 4's image candidates. They are fetched before the job exists, so they
// live in their own cache next to the job dirs - and therefore need an orphan
// sweep at app start. Deliberately electron-free, same split as creations.ts
// against ipc.ts: everything here takes a directory, and the jobId-keyed
// wrappers that ask electron for userData live in ipc.ts.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { findCover } from "../../core/api/artwork/coverArtArchive.ts";

export type CoverKandidat = {
  kind: "caa" | "thumbnail";
  pfad: string;
  dataUrl: string;
};

export type KandidatenDeps = {
  findCoverFn?: typeof findCover;
  fetchFn?: typeof fetch;
};

export type KandidatenAnfrage = {
  artist: string;
  title: string;
  thumbnailUrl?: string;
  deps?: KandidatenDeps;
};

const alsDataUrl = (bytes: Uint8Array): string =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

const holeThumbnail = async (
  url: string,
  f: typeof fetch,
): Promise<Uint8Array | null> => {
  try {
    const antwort = await f(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!antwort.ok) return null;
    if (!antwort.body) return null;
    const reader = antwort.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 5_000_000) return null;
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
};

export const holeCoverKandidatenIn = async (
  dir: string,
  a: KandidatenAnfrage,
): Promise<CoverKandidat[]> => {
  const findCoverFn = a.deps?.findCoverFn ?? findCover;
  const f = a.deps?.fetchFn ?? fetch;
  await mkdir(dir, { recursive: true });

  const kandidaten: CoverKandidat[] = [];

  const roh = await Effect.runPromise(findCoverFn(a.artist, a.title));
  if (roh !== null && roh.length > 0) {
    const pfad = join(dir, "caa.jpg");
    await writeFile(pfad, roh);
    kandidaten.push({ kind: "caa", pfad, dataUrl: alsDataUrl(roh) });
  }

  if (a.thumbnailUrl) {
    const bytes = await holeThumbnail(a.thumbnailUrl, f);
    if (bytes) {
      const pfad = join(dir, "thumbnail.jpg");
      await writeFile(pfad, bytes);
      kandidaten.push({ kind: "thumbnail", pfad, dataUrl: alsDataUrl(bytes) });
    }
  }

  return kandidaten;
};

export const raeumeWaisenIn = async (
  wurzel: string,
  bekannteIds: string[],
): Promise<void> => {
  let eintraege: string[] = [];
  try {
    eintraege = await readdir(wurzel);
  } catch {
    return; // Kein Cache-Verzeichnis: nichts aufzuraeumen.
  }
  const bekannt = new Set(bekannteIds);
  for (const name of eintraege) {
    if (bekannt.has(name)) continue;
    await rm(join(wurzel, name), { recursive: true, force: true });
  }
};
