import { readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { CreateJob } from "../create/job.ts";
import { resolveDataFilePath } from "./paths.ts";

const DATEI = "create-queue.json";

export const loadCreateQueue: Effect.Effect<CreateJob[], Error> = Effect.gen(
  function* () {
    const filePath = yield* resolveDataFilePath(DATEI);
    return yield* Effect.catchAll(
      Effect.tryPromise({
        try: async () => {
          const text = await readFile(filePath, "utf8");
          const json = JSON.parse(text);
          return Array.isArray(json) ? (json as CreateJob[]) : [];
        },
        catch: (e) =>
          e instanceof Error ? e : new Error("Failed to load create queue"),
      }),
      () => Effect.succeed([] as CreateJob[]),
    );
  },
);

export const saveCreateQueue = (
  jobs: CreateJob[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const filePath = yield* resolveDataFilePath(DATEI);
    yield* Effect.tryPromise({
      try: async () => writeFile(filePath, JSON.stringify(jobs, null, 2)),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to save create queue"),
    });
  });
