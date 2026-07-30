import { expect, mock, test } from "bun:test";

mock.module("electron", () => ({
  app: { getVersion: () => "0.0.0-test", getPath: () => "C:\\tmp-test" },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => "" },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { selectEvictions } = await import("./covers.ts");

test("returns empty list when under the limit", () => {
  const files = [
    { path: "a.jpg", size: 100, mtimeMs: 1 },
    { path: "b.jpg", size: 100, mtimeMs: 2 },
  ];
  expect(selectEvictions(files, 1000)).toEqual([]);
});

test("evicts oldest files first until under the limit", () => {
  const files = [
    { path: "old.jpg", size: 400, mtimeMs: 1 },
    { path: "mid.jpg", size: 400, mtimeMs: 2 },
    { path: "new.jpg", size: 400, mtimeMs: 3 },
  ];
  // total 1200, limit 800 → oldest (old.jpg) gets evicted
  expect(selectEvictions(files, 800)).toEqual(["old.jpg"]);
});

test("evicts multiple when one is not enough", () => {
  const files = [
    { path: "a.jpg", size: 500, mtimeMs: 1 },
    { path: "b.jpg", size: 500, mtimeMs: 2 },
    { path: "c.jpg", size: 500, mtimeMs: 3 },
  ];
  expect(selectEvictions(files, 600)).toEqual(["a.jpg", "b.jpg"]);
});
