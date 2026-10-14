import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegularText } from "./read-regular-text.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots.length = 0;
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-read-text-"));
  roots.push(root);
  const file = join(root, "song.txt");
  await writeFile(file, "checked content");
  return { root, file };
};

describe("readRegularText", () => {
  it.skipIf(process.platform !== "linux")(
    "skips FIFOs without waiting for a writer",
    async () => {
      const { root } = await fixture();
      const fifo = join(root, "pipe.txt");
      const result = Bun.spawnSync(["mkfifo", fifo]);
      expect(result.exitCode).toBe(0);
      expect(await readRegularText(fifo)).toBeNull();
    },
  );
  it("reads the checked descriptor even if the pathname is replaced after stat", async () => {
    const { root, file } = await fixture();
    let closed = false;
    const text = await readRegularText(file, async (path, flags) => {
      const handle = await open(path, flags);
      return {
        stat: async () => {
          const info = await handle.stat();
          await rename(file, join(root, "original.txt"));
          await writeFile(file, "attacker replacement");
          return info;
        },
        readFile: (encoding) => handle.readFile(encoding),
        close: async () => {
          closed = true;
          await handle.close();
        },
      };
    });
    expect(text).toBe("checked content");
    expect(await readFile(file, "utf8")).toBe("attacker replacement");
    expect(closed).toBe(true);
  });
  it("reads normal UTF8 song files", async () => {
    const { file } = await fixture();
    expect(await readRegularText(file)).toBe("checked content");
  });
  it("rejects missing files and skips directories", async () => {
    const { root } = await fixture();
    await expect(readRegularText(join(root, "missing"))).rejects.toThrow();
    await mkdir(join(root, "directory"));
    expect(await readRegularText(join(root, "directory"))).toBeNull();
  });
  it.skipIf(process.platform === "win32")(
    "refuses symlinks when O_NOFOLLOW is available",
    async () => {
      const { root, file } = await fixture();
      const link = join(root, "link.txt");
      await symlink(file, link);
      await expect(readRegularText(link)).rejects.toThrow();
    },
  );
  it("closes descriptors when reading fails", async () => {
    const { file } = await fixture();
    let closed = false;
    await expect(
      readRegularText(file, async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: () => handle.stat(),
          readFile: async () => {
            throw new Error("read failed");
          },
          close: async () => {
            closed = true;
            await handle.close();
          },
        };
      }),
    ).rejects.toThrow("read failed");
    expect(closed).toBe(true);
  });
});
