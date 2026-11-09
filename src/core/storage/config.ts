import { readFile } from "node:fs/promises";
import { atomicWrite, serializeFile } from "./atomicFile.ts";
import { Effect } from "effect";
import { resolveDataFilePath } from "./paths.ts";

export type AppConfig = {
  downloadDir: string;
  browser: string;
  genreProvider?: string;
  lastfmApiKey?: string;
  folderLayout?: string;
  downloadConcurrency?: number;
  videoQuality?: string;
  /** UI language: "de" | "en" | "es". Absent means follow the system. */
  uiLanguage?: string;
};
const FILE_NAME = "config.json";

export const loadConfig: Effect.Effect<AppConfig | null, Error> = Effect.gen(
  function* () {
    const path = yield* resolveDataFilePath(FILE_NAME);
    return yield* Effect.catchAll(
      Effect.tryPromise({
        try: async () => JSON.parse(await readFile(path, "utf8")) as AppConfig,
        catch: (e) =>
          e instanceof Error ? e : new Error("Failed to read config"),
      }),
      () => Effect.succeed(null),
    );
  },
);

export const saveConfig = (
  config: AppConfig,
): Effect.Effect<AppConfig, Error> =>
  Effect.gen(function* () {
    const path = yield* resolveDataFilePath(FILE_NAME);
    return yield* Effect.tryPromise({
      try: () =>
        serializeFile(path, async () => {
          let existing: AppConfig | null = null;
          try {
            existing = JSON.parse(await readFile(path, "utf8"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          const merged = { ...existing, ...config };
          await atomicWrite(path, JSON.stringify(merged, null, 2));
          return merged;
        }),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to write config"),
    });
  });
