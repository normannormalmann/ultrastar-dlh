import { defineConfig } from "@playwright/test";

// Test windows open on a secondary monitor and without taking the focus
// (see testPlatzierung in src/desktop/main/index.ts). Workers and the
// launched Electron inherit this. Set it to "" to watch on the main screen.
process.env.ULTRASTAR_E2E_DISPLAY ??= "secondary";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // One Electron at a time: parallel instances share the userData folder
  // and trip over each other (measured: --repeat-each with three workers
  // failed, serially every run passed).
  workers: 1,
  use: { trace: "retain-on-failure" },
});
