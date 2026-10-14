import { Effect } from "effect";
import { API_URL } from "./config.ts";

export type Song = {
  apiId: number;
  artist: string;
  title: string;
  languages: string[];
  genre?: string;
  year?: number;
  edition?: string;
  goldenNotes?: boolean;
  creator?: string;
  rating?: number; // 0–5, halbe Sterne
  views?: number;
};

export type Page = {
  totalPages: number;
  songs: Song[];
};

export type SearchOrder =
  | "lastchange"
  | "interpret"
  | "title"
  | "year"
  | "rating"
  | "views";

export type SearchParams = {
  interpret?: string; // artist name
  title?: string; // song title
  language?: string;
  genre?: string;
  year?: number;
  order?: SearchOrder; // default: lastchange
  ud?: "asc" | "desc"; // default: desc
  limit?: number; // max 100
  start?: number; // pagination offset
  golden?: boolean;
  songcheck?: boolean;
};

/** Decode one layer only; generated ampersands must not become new entities. */
const decodeHtmlEntities = (str: string): string => {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return str.replace(
    /&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g,
    (entity: string, value: string) => {
      if (!value.startsWith("#")) return named[value] ?? entity;
      const hex = value.startsWith("#x");
      return String.fromCharCode(
        Number.parseInt(value.slice(hex ? 2 : 1), hex ? 16 : 10),
      );
    },
  );
};

/**
 * Parse single song result
 * @param html HTML string from parseSongsFromSearch
 * @returns Song object with id, artist, title and languages fields
 */
export const parseSongFromTable = (html: string | undefined): Song | null => {
  if (!html) return null;

  const songId = Number.parseInt(
    html.match(/show_detail\((\d+)\)/)?.[1] ?? "0",
    10,
  );
  const songMetadata = [
    ...html.matchAll(/<td\s+.*?>(?:<a.*?>)?(.*)<\/td>/gm),
  ].map((m) => m?.[1]);

  const artist = songMetadata?.[0]
    ? decodeHtmlEntities(songMetadata[0])
    : undefined;
  const title = songMetadata?.[1]
    ? decodeHtmlEntities(songMetadata[1])
    : undefined;
  // Type guard: ensure songMetadata[6] exists and is a string before calling toLowerCase()
  const languages =
    typeof songMetadata?.[6] === "string"
      ? songMetadata[6].toLowerCase().split(", ")
      : undefined;

  if (!songId || !artist || !title || !languages) return null;

  const text = (i: number): string | undefined => {
    const v = songMetadata?.[i];
    return typeof v === "string" && v.trim().length > 0
      ? decodeHtmlEntities(v.trim())
      : undefined;
  };
  const num = (i: number): number | undefined => {
    const v = text(i);
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  };
  const ratingCell = songMetadata?.[8] ?? "";
  const fullStars = (ratingCell.match(/images\/star\.png/g) ?? []).length;
  const halfStars = (ratingCell.match(/images\/half_star\.png/g) ?? []).length;
  const rating =
    fullStars + halfStars > 0 ? fullStars + 0.5 * halfStars : undefined;

  return {
    apiId: songId,
    artist,
    title,
    languages,
    genre: text(2),
    year: num(3),
    edition: text(4),
    goldenNotes: (songMetadata?.[5] ?? "").trim().toLowerCase() === "yes",
    creator: text(7),
    rating,
    views: num(9),
  };
};

/**
 * Parse songs from search result as page
 * @param html HTML string from searchPage
 * @returns Page object with totalPages and songs fields
 */
export const parseSongsFromSearch = (html: string): Page => {
  const totalPages = Number.parseInt(
    html.match(/<br>There are\s+\d+\s+results? on\s+(\d+)\s+page/)?.[1] ?? "0",
    10,
  );

  const songsHtml = [
    ...html.matchAll(/<tr class="list_tr[12].*?>\s*([\s\S]*?)\s*<\/tr>/gm),
  ];
  const parsed = songsHtml.map((s) => parseSongFromTable(s?.[1]));
  const failedCount = parsed.filter((s) => s === null).length;
  if (failedCount > 0) {
    console.warn(
      `[usdb/search] ${failedCount}/${parsed.length} song(s) failed to parse from search results`,
    );
  }
  const songs = parsed.filter((s): s is Song => Boolean(s));

  return {
    totalPages,
    songs,
  };
};

const clampLimit = (limit: number | undefined): number => {
  if (limit == null || Number.isNaN(limit)) return 100;
  return Math.min(100, Math.max(1, Math.floor(limit)));
};

const normalizeStart = (start: number | undefined): number => {
  if (start == null || Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor(start));
};

export const buildFormBody = (params: SearchParams): URLSearchParams => {
  const form = new URLSearchParams();
  form.set("order", params.order ?? "lastchange");
  form.set("ud", params.ud ?? "desc");

  if (params.interpret && params.interpret.trim().length > 0) {
    form.set("interpret", params.interpret.trim());
  }
  if (params.title && params.title.trim().length > 0) {
    form.set("title", params.title.trim());
  }
  if (params.language && params.language.trim().length > 0) {
    form.set("language", params.language.trim());
  }
  if (params.genre && params.genre.trim().length > 0) {
    form.set("genre", params.genre.trim());
  }
  if (params.year != null && Number.isFinite(params.year)) {
    form.set("year", String(Math.floor(params.year)));
  }
  if (params.golden === true) form.set("golden", "1");
  if (params.songcheck === true) form.set("songcheck", "1");
  form.set("limit", String(clampLimit(params.limit)));
  form.set("start", String(normalizeStart(params.start)));

  return form;
};

/**
 * Scrape the search page and parse results into a Page object.
 */
export const searchSongs = (
  params: SearchParams,
  cookie?: string,
): Effect.Effect<Page, Error, never> =>
  Effect.gen(function* () {
    const form = buildFormBody(params);
    const response = yield* Effect.tryPromise({
      try: async () =>
        await fetch(`${API_URL}/?link=list`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: form.toString(),
        }),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to execute request"),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new Error(
          `Search request failed: ${response.status} ${response.statusText}`,
        ),
      );
    }

    const html = yield* Effect.tryPromise({
      try: async () => await response.text(),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to read response body"),
    });

    return parseSongsFromSearch(html);
  });
