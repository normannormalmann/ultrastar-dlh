/** Non-genres (mostly Last.fm tags) that must never be treated as a genre. */
const BLOCKLIST = new Set([
  "seen live",
  "favorites",
  "favourite",
  "favourites",
  "spotify",
  "my music",
  "awesome",
  "beautiful",
  "love",
  "german",
  "english",
  "deutsch",
  "00s",
  "10s",
  "60s",
  "70s",
  "80s",
  "90s",
  "2000s",
]);

/** Variants → canonical genre (keys lowercase). */
const CANONICAL: Record<string, string> = {
  "hip hop": "Hip-Hop",
  "hip-hop": "Hip-Hop",
  hiphop: "Hip-Hop",
  "rap/hip hop": "Hip-Hop",
  rap: "Rap",
  "r&b": "R&B",
  rnb: "R&B",
  "r&b/soul": "R&B",
  "soul & funk": "Soul",
  electro: "Electronic",
  electronica: "Electronic",
  "dance & edm": "Dance",
  edm: "Dance",
  "alternative rock": "Rock",
  alternative: "Rock",
  "indie rock": "Rock",
  "hard rock": "Rock",
  "heavy metal": "Metal",
  "singer-songwriter": "Folk",
  "singer/songwriter": "Folk",
  "films/games": "Soundtrack",
  "film scores": "Soundtrack",
  musicals: "Musical",
  "comédies musicales": "Musical",
  "chanson française": "Chanson",
  "country & folk": "Country",
  "kids & family": "Kinderlieder",
  christmas: "Christmas",
  weihnachten: "Christmas",
};

const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(" ");

export type CleanQuery = { artist: string; title: string };

/**
 * Cleans up artist/title ONLY for the online search (stored data stays
 * unchanged): trailing parenthetical additions, typographic quotes,
 * featuring chains.
 */
export const cleanupSearchQuery = (
  artist: string,
  title: string,
): CleanQuery => {
  const fixQuotes = (s: string): string =>
    s.replace(/['‘’‛`´]/g, "'").replace(/[“”„‟«»]/g, '"');

  let t = fixQuotes(title).trim();
  // Iteratively strip trailing (…) and […] groups — only at the end
  for (;;) {
    const stripped = t.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "");
    if (stripped === t || stripped.length === 0) break;
    t = stripped.trim();
  }

  let a = fixQuotes(artist).trim();
  const featMatch = /\s+(?:feat\.?|ft\.?|featuring)\s+/i.exec(a);
  if (featMatch && featMatch.index > 0) {
    a = a.slice(0, featMatch.index).trim();
  }

  return { artist: a, title: t };
};

/** Normalize a raw genre from a source; null = unusable. */
export const normalizeGenre = (raw: string): string | null => {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.length === 0) return null;
  if (BLOCKLIST.has(cleaned)) return null;
  return CANONICAL[cleaned] ?? titleCase(cleaned);
};
