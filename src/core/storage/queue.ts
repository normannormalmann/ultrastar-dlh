import { readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { Song } from "../api/usdb/search.ts";
import { resolveDataFilePath } from "./paths.ts";

export const loadQueue: Effect.Effect<Song[], Error> = Effect.gen(function* () {
  const filePath = yield* resolveDataFilePath("queue.json");
  return yield* Effect.catchAll(
    Effect.tryPromise({
      try: async () => {
        const text = await readFile(filePath, "utf8");
        const json = JSON.parse(text);
        return Array.isArray(json) ? (json as Song[]) : [];
      },
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to load queue"),
    }),
    () => Effect.succeed([] as Song[]),
  );
});

export const saveQueue = (queue: Song[]): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const filePath = yield* resolveDataFilePath("queue.json");
    yield* Effect.tryPromise({
      try: async () => writeFile(filePath, JSON.stringify(queue, null, 2)),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to save queue"),
    });
  });
