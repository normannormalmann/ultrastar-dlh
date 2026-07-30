import type { Effect } from "effect";

export type GenreLookupResult = {
  genre: string;
  year?: number;
  realBpm?: number;
  explicit?: boolean;
} | null;

export type GenreProviderId = "deezer" | "lastfm" | "musicbrainz";

export type GenreProvider = {
  id: GenreProviderId;
  name: string;
  /** Minimum delay between lookups (rate limit). */
  minDelayMs: number;
  lookup: (
    artist: string,
    title: string,
  ) => Effect.Effect<GenreLookupResult, Error>;
};

/** Artist comparison for match validation: lowercase, no special characters. */
export const artistMatches = (a: string, b: string): boolean => {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const na = norm(a);
  const nb = norm(b);
  return na.length > 0 && (na === nb || na.includes(nb) || nb.includes(na));
};
