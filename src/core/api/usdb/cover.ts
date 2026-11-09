import { Effect } from "effect";
import { API_URL } from "./config.ts";

/**
 * Download song cover image bytes by id.
 * Returns null if the image is not available (non-ok response).
 */
export const downloadCoverById = (
  id: number,
  cookie?: string,
): Effect.Effect<Uint8Array | null, Error, never> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () =>
        await fetch(`${API_URL}/data/cover/${id}.jpg`, {
          signal: AbortSignal.timeout(30_000),
          method: "GET",
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
          },
        }),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to fetch cover"),
    });

    if (!response.ok) {
      return null;
    }

    // Validate content length to prevent memory exhaustion (max 10 MB)
    const MAX_COVER_SIZE = 10 * 1024 * 1024;
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_COVER_SIZE) {
      console.warn(
        `[usdb/cover] Cover image too large (${contentLength} bytes), skipping`,
      );
      return null;
    }

    const buffer = yield* Effect.tryPromise({
      try: async () => {
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > MAX_COVER_SIZE) {
          console.warn(
            `[usdb/cover] Cover image too large (${data.byteLength} bytes), skipping`,
          );
          return null;
        }
        return data;
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to read cover bytes"),
    });

    return buffer;
  });
