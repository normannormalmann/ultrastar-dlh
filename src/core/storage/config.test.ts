import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { getCacheDir } from "./paths.ts";
import { loadConfig, saveConfig } from "./config.ts";

const appName = `ultrastar-cli-config-test-${process.pid}`;
let previousAppName: string | undefined;

beforeEach(() => {
  previousAppName = process.env.ULTRASTAR_APP_NAME;
  process.env.ULTRASTAR_APP_NAME = appName;
});

afterEach(() => {
  if (previousAppName === undefined) delete process.env.ULTRASTAR_APP_NAME;
  else process.env.ULTRASTAR_APP_NAME = previousAppName;
});

afterAll(async () => {
  const dir = await Effect.runPromise(getCacheDir(appName));
  await rm(dir, { recursive: true, force: true });
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
