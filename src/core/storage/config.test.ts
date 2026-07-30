import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import { getCacheDir } from "./paths.ts";
import { loadConfig, saveConfig } from "./config.ts";

process.env.ULTRASTAR_APP_NAME = `ultrastar-cli-config-test-${process.pid}`;

afterAll(async () => {
  const dir = await Effect.runPromise(getCacheDir());
  await rm(join(dir, ".."), { recursive: true, force: true });
});

test("saveConfig merges with existing fields instead of wiping them", async () => {
  await Effect.runPromise(
    saveConfig({
      downloadDir: "D:\\x",
      browser: "edge",
      genreProvider: "lastfm",
      lastfmApiKey: "k",
    }),
  );
  await Effect.runPromise(
    saveConfig({ downloadDir: "D:\\y", browser: "chrome" }),
  );
  const cfg = await Effect.runPromise(loadConfig);
  expect(cfg?.downloadDir).toBe("D:\\y");
  expect(cfg?.genreProvider).toBe("lastfm");
  expect(cfg?.lastfmApiKey).toBe("k");
});
