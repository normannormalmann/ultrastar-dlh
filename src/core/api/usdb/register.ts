import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import { API_URL } from "./config.ts";

export type Registration = {
  user: string;
  pass: string;
  email: string;
};

const buildRegistrationForm = (r: Registration): URLSearchParams => {
  const form = new URLSearchParams();
  form.set("user", r.user);
  form.set("mail", r.email);
  form.set("pass", r.pass);
  form.set("pass2", r.pass);
  form.set("sprache", "English");
  form.set("Submit", "Submit");
  return form;
};

export const register = (r: Registration): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () =>
        await fetch(`${API_URL}/index.php?link=register`, {
          signal: AbortSignal.timeout(30_000),
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: buildRegistrationForm(r).toString(),
        }),
      catch: (e) =>
        e instanceof Error ? e : new Error("Register request failed"),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`Register failed: ${response.status} ${response.statusText}`),
      );
    }
  });

export const generateRandomUsername = (): string => {
  const random = Math.random().toString(36).slice(2, 8);
  const suffix = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, "0");
  return `user-${random}-${suffix}`;
};

export const generateRandomPassword = (length = 14): string => {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%^&*()_+-=";
  // Use rejection sampling to avoid modulo bias
  const maxValid = 256 - (256 % chars.length);
  let pass = "";
  while (pass.length < length) {
    const randomBytesBuffer = randomBytes(length - pass.length + 4);
    for (let i = 0; i < randomBytesBuffer.length && pass.length < length; i++) {
      // Reject values that would introduce modulo bias
      if (randomBytesBuffer[i]! < maxValid) {
        pass += chars[randomBytesBuffer[i]! % chars.length];
      }
    }
  }
  return pass;
};
