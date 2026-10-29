import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // One Electron at a time: parallel instances share the userData folder
  // and trip over each other (measured: --repeat-each with three workers
  // failed, serially every run passed).
  workers: 1,
  use: { trace: "retain-on-failure" },
});
