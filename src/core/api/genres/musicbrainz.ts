import { Effect } from "effect";
import { cleanupSearchQuery, normalizeGenre } from "./normalize.ts";
import {
  artistMatches,
  type GenreLookupResult,
  type GenreProvider,
} from "./provider.ts";

const USER_AGENT =
  "ultrastar-dlh/1.4.0 (https://github.com/normannormalmann/ultrastar-dlh)";

type MbSearch = {
  recordings?: Array<{
    title?: string;
    "artist-credit"?: Array<{ name?: string }>;
    "first-release-date"?: string;
    tags?: Array<{ name?: string; count?: number }>;
  }>;
};

export const pickMusicbrainzResult = (
  res: MbSearch,
  artist: string,
  cleanedArtist?: string,
): { genre: string; year?: number } | null => {
  for (const rec of res.recordings ?? []) {
    const credit = rec["artist-credit"]?.[0]?.name;
    if (
      !credit ||
      (!artistMatches(credit, artist) &&
        !(cleanedArtist && artistMatches(credit, cleanedArtist)))
    )
      continue;
    const tags = [...(rec.tags ?? [])].sort(
      (a, b) => (b.count ?? 0) - (a.count ?? 0),
    );
    for (const t of tags) {
      if (!t.name) continue;
      const genre = normalizeGenre(t.name);
      if (genre) {
        const year = rec["first-release-date"]
          ? Number.parseInt(rec["first-release-date"].slice(0, 4), 10)
          : Number.NaN;
        return { genre, ...(Number.isNaN(year) ? {} : { year }) };
      }
    }
  }
  return null;
};

export const musicbrainzProvider: GenreProvider = {
  id: "musicbrainz",
  name: "MusicBrainz",
  minDelayMs: 1100,
  lookup: (artist, title) =>
    Effect.gen(function* () {
      const cleaned = cleanupSearchQuery(artist, title);
      const query = encodeURIComponent(
        `artist:"${cleaned.artist}" AND recording:"${cleaned.title}"`,
      );
      const res = yield* Effect.tryPromise({
        try: async () => {
          const r = await fetch(
            `https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=5`,
            { headers: { "User-Agent": USER_AGENT } },
          );
          if (!r.ok) throw new Error(`MusicBrainz ${r.status}`);
          return (await r.json()) as MbSearch;
        },
        catch: (e) =>
          e instanceof Error ? e : new Error("MusicBrainz request failed"),
      });
      return pickMusicbrainzResult(
        res,
        artist,
        cleaned.artist,
      ) as GenreLookupResult;
    }),
};
