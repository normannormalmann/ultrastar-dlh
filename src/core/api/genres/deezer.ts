import { Effect } from "effect";
import { cleanupSearchQuery, normalizeGenre } from "./normalize.ts";
import {
  artistMatches,
  type GenreLookupResult,
  type GenreProvider,
} from "./provider.ts";

type DeezerSearch = {
  data?: Array<{
    id: number;
    title: string;
    bpm?: number;
    explicit_lyrics?: boolean;
    artist?: { name?: string };
    album?: { id?: number };
  }>;
};

type DeezerAlbum = {
  release_date?: string;
  genres?: { data?: Array<{ name?: string }> };
};

export type DeezerTrackPick = {
  albumId: number;
  realBpm?: number;
  explicit?: boolean;
} | null;

export const pickDeezerTracks = (
  res: DeezerSearch,
  artist: string,
  cleanedArtist?: string,
): NonNullable<DeezerTrackPick>[] => {
  const results: NonNullable<DeezerTrackPick>[] = [];
  const seenAlbums = new Set<number>();
  for (const t of res.data ?? []) {
    if (results.length >= 3) break;
    if (!t.album?.id || !t.artist?.name) continue;
    if (seenAlbums.has(t.album.id)) continue;
    if (
      !artistMatches(t.artist.name, artist) &&
      !(cleanedArtist && artistMatches(t.artist.name, cleanedArtist))
    )
      continue;
    seenAlbums.add(t.album.id);
    results.push({
      albumId: t.album.id,
      ...(t.bpm && t.bpm > 0 ? { realBpm: t.bpm } : {}),
      ...(t.explicit_lyrics !== undefined
        ? { explicit: t.explicit_lyrics }
        : {}),
    });
  }
  return results;
};

export const parseDeezerAlbum = (
  album: DeezerAlbum,
): { genre: string; year?: number } | null => {
  const rawGenre = album.genres?.data?.[0]?.name;
  if (!rawGenre) return null;
  const genre = normalizeGenre(rawGenre);
  if (!genre) return null;
  const year = album.release_date
    ? Number.parseInt(album.release_date.slice(0, 4), 10)
    : Number.NaN;
  return { genre, ...(Number.isNaN(year) ? {} : { year }) };
};

const fetchJson = (url: string): Effect.Effect<unknown, Error> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Deezer ${res.status} for ${url}`);
      return res.json();
    },
    catch: (e) => (e instanceof Error ? e : new Error("Deezer request failed")),
  });

export const deezerProvider: GenreProvider = {
  id: "deezer",
  name: "Deezer",
  minDelayMs: 250,
  lookup: (artist, title) =>
    Effect.gen(function* () {
      const cleaned = cleanupSearchQuery(artist, title);
      const q = encodeURIComponent(
        `artist:"${cleaned.artist}" track:"${cleaned.title}"`,
      );
      const search = (yield* fetchJson(
        `https://api.deezer.com/search?q=${q}&limit=5`,
      )) as DeezerSearch;
      const picks = pickDeezerTracks(search, artist, cleaned.artist);
      for (const pick of picks) {
        const album = (yield* fetchJson(
          `https://api.deezer.com/album/${pick.albumId}`,
        )) as DeezerAlbum;
        const parsed = parseDeezerAlbum(album);
        if (!parsed) continue;
        return {
          ...parsed,
          ...(pick.realBpm !== undefined ? { realBpm: pick.realBpm } : {}),
          ...(pick.explicit !== undefined ? { explicit: pick.explicit } : {}),
        } as GenreLookupResult;
      }
      return null as GenreLookupResult;
    }),
};
