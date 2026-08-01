// src/core/api/artwork/coverArtArchive.ts
// Album art for songs the user creates himself. USDB downloads get their
// cover from USDB; a self-made song has no apiId, so the artwork comes
// from MusicBrainz (which release is this?) plus the Cover Art Archive
// (give me its front image).
import { Effect } from "effect";

/**
 * MusicBrainz scores a search hit 0-100. Below this we would rather ship
 * no cover than the wrong album - a wrong cover is worse than none.
 * Starting value; to be re-measured once real songs run through.
 */
export const MIN_SCORE = 90;

const SUCHE = "https://musicbrainz.org/ws/2/recording";
// MusicBrainz asks every client to identify itself; anonymous bulk
// traffic gets throttled.
const AGENT = "ultrastar-dlh/1.0 (https://github.com/normannormalmann/ultrastar-dlh)";

type Recording = { score?: number; releases?: Array<{ id?: string }> };

/** Never fails: no hit, bad hit or no network all mean "no cover". */
export const findCover = (
  artist: string,
  title: string,
  fetchFn: typeof fetch = fetch,
): Effect.Effect<Uint8Array | null, never> =>
  Effect.promise(async () => {
    try {
      const query = `recording:"${title}" AND artist:"${artist}"`;
      const url = `${SUCHE}?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
      const antwort = await fetchFn(url, {
        headers: { "User-Agent": AGENT, Accept: "application/json" },
      });
      if (!antwort.ok) return null;
      const daten = (await antwort.json()) as { recordings?: Recording[] };
      const treffer = (daten.recordings ?? []).find(
        (r) => (r.score ?? 0) >= MIN_SCORE && (r.releases ?? []).length > 0,
      );
      const releaseId = treffer?.releases?.[0]?.id;
      if (!releaseId) return null;

      const bild = await fetchFn(
        `https://coverartarchive.org/release/${releaseId}/front`,
        { headers: { "User-Agent": AGENT } },
      );
      if (!bild.ok) return null;
      return new Uint8Array(await bild.arrayBuffer());
    } catch {
      // Offline, DNS failure, malformed JSON - the cover is optional.
      return null;
    }
  });
