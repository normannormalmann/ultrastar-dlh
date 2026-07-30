import { expect, mock, test } from "bun:test";

mock.module("electron", () => ({
  app: { getVersion: () => "0.0.0-test", getPath: () => "C:\\tmp-test" },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => "" },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { INVOKE_CHANNELS } = await import("../shared/ipcContract.ts");
const { handlers } = await import("./ipc.ts");

test("every invoke channel from the contract has exactly one handler", () => {
  const handlerChannels = Object.keys(handlers).sort();
  expect(handlerChannels).toEqual([...INVOKE_CHANNELS].sort());
});

test("handlers are functions", () => {
  for (const fn of Object.values(handlers)) {
    expect(typeof fn).toBe("function");
  }
});
