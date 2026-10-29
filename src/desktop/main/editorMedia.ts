// src/desktop/main/editorMedia.ts
// Serves the song audio to the editor's <audio> element. A data URL would
// mean pushing a 100 MB video through IPC; file:// is blocked by the CSP and
// would hand the renderer every file on disk. Instead the main process hands
// out opaque tokens, one per opened song, and only those paths are served.
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

export const MEDIA_SCHEME = "songmedia";

/** Only the songs open lately - an editor never needs more than one. */
const MAX_TOKENS = 4;
const tokens = new Map<string, string>();

export const registerMedia = (path: string): string => {
  const token = randomUUID();
  tokens.set(token, path);
  while (tokens.size > MAX_TOKENS) {
    const aeltester = tokens.keys().next().value;
    if (aeltester === undefined) break;
    tokens.delete(aeltester);
  }
  return `${MEDIA_SCHEME}://media/${token}`;
};

export const resolveMediaToken = (url: string): string | null => {
  const match = /^songmedia:\/\/media\/([0-9a-f-]{36})$/i.exec(url);
  return match ? (tokens.get(match[1] as string) ?? null) : null;
};

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

export const mimeFor = (path: string): string =>
  MIME[extname(path).toLowerCase()] ?? "application/octet-stream";

/**
 * Parses a single "bytes=a-b" range. Seeking in <audio> depends on it: a
 * server that ignores ranges makes Chromium refuse to jump. Multi-range
 * requests are never sent by a media element and are answered whole.
 */
export const parseRange = (
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null => {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, von, bis] = m as unknown as [string, string, string];
  if (von === "" && bis === "") return "invalid";
  let start: number;
  let end: number;
  if (von === "") {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(bis));
    end = size - 1;
  } else {
    start = Number(von);
    end = bis === "" ? size - 1 : Math.min(Number(bis), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
};

export const serveMedia = async (request: Request): Promise<Response> => {
  const pfad = resolveMediaToken(request.url);
  if (pfad === null) return new Response(null, { status: 404 });
  let size: number;
  try {
    size = (await stat(pfad)).size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const typ = mimeFor(pfad);
  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${size}` },
    });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  // Node's and the DOM's ReadableStream typings disagree; at runtime both
  // are the same web stream.
  const koerper = Readable.toWeb(
    createReadStream(pfad, { start, end }),
  ) as unknown as BodyInit;
  return new Response(koerper, {
    status: range ? 206 : 200,
    headers: {
      "content-type": typ,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
};
