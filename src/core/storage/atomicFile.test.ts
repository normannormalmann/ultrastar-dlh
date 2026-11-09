import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeFile, writeJson } from "./atomicFile.ts";

test("failed writes leave later transactions usable and successful writes remain ordered", async () => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-atomic-"));
  try {
    const path = join(root, "data.json");
    await mkdir(path);
    await expect(writeJson(path, { value: 0 })).rejects.toBeDefined();
    await rm(path, { recursive: true });
    await Promise.all([
      writeJson(path, { value: 1 }),
      writeJson(path, { value: 2 }),
    ]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ value: 2 });
    const order: number[] = [];
    await Promise.all([
      serializeFile(path, async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(1);
      }),
      serializeFile(path, async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
