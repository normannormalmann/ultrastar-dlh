import { protectSecret } from "./protectSecret.ts";
import { readFile } from "node:fs/promises";
import { writeJson } from "./atomicFile.ts";
import { Effect } from "effect";
import { resolveDataFilePath } from "./paths.ts";

export type StoredCredentials = {
  user: string;
  pass: string;
};

const FILE_NAME = "credentials.json";

const readJsonFile = (path: string): Effect.Effect<unknown, Error> =>
  Effect.tryPromise({
    try: async () => {
      try {
        return JSON.parse(await readFile(path, "utf8")) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    catch: () =>
      new Error("Could not read stored credentials; refusing to replace them"),
  });

const writeJsonFile = (
  path: string,
  data: unknown,
): Effect.Effect<true, Error> =>
  Effect.tryPromise({
    try: async () => {
      const stored =
        process.platform === "win32"
          ? {
              protection: "dpapi",
              data: await protectSecret(JSON.stringify(data)),
            }
          : data;
      await writeJson(path, stored);
      return true as const;
    },
    catch: (e) => (e instanceof Error ? e : new Error("Failed to write file")),
  });

/**
 * Validates and sanitizes credentials with runtime checks.
 * Ensures fields meet security requirements.
 */
const validateCredentials = (data: unknown): data is StoredCredentials => {
  // Type guard: check if data is an object with required fields
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const creds = data as Record<string, unknown>;

  // Check if required fields exist and are strings
  if (typeof creds.user !== "string" || typeof creds.pass !== "string") {
    return false;
  }

  // Trim whitespace
  const user = creds.user.trim();
  const pass = creds.pass;

  // Validate lengths (prevent DoS with very long strings)
  const MIN_LENGTH = 1;
  const MAX_LENGTH = 255;

  if (
    user.length < MIN_LENGTH ||
    user.length > MAX_LENGTH ||
    pass.length < MIN_LENGTH ||
    pass.length > MAX_LENGTH
  ) {
    return false;
  }

  // Update the object with trimmed values
  creds.user = user;
  creds.pass = pass;

  return true;
};

export const loadCredentials: Effect.Effect<StoredCredentials | null, Error> =
  Effect.gen(function* () {
    const path = yield* resolveDataFilePath(FILE_NAME);
    let data: unknown = yield* readJsonFile(path);
    if (data && typeof data === "object" && "protection" in data) {
      const envelope = data as { protection: unknown; data?: unknown };
      if (
        envelope.protection !== "dpapi" ||
        typeof envelope.data !== "string" ||
        process.platform !== "win32"
      )
        return yield* Effect.fail(
          new Error("Credentials require the Windows account that saved them"),
        );
      const ciphertext = envelope.data;
      data = yield* Effect.tryPromise({
        try: async () => JSON.parse(await protectSecret(ciphertext, true)),
        catch: () =>
          new Error(
            "Could not decrypt stored credentials; refusing to replace them",
          ),
      });
    } else if (process.platform === "win32" && validateCredentials(data)) {
      yield* writeJsonFile(path, data);
    }

    // Use runtime validation instead of type assertion
    if (validateCredentials(data)) {
      return data; // Now type-safe due to validateCredentials type guard
    }

    if (data !== null)
      return yield* Effect.fail(
        new Error("Invalid stored credentials; refusing to replace them"),
      );
    return null;
  });

export const saveCredentials = (
  creds: StoredCredentials,
): Effect.Effect<StoredCredentials, Error> =>
  Effect.gen(function* () {
    const path = yield* resolveDataFilePath(FILE_NAME);
    yield* writeJsonFile(path, creds);
    return creds;
  });
