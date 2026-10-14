import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeZipEntry, extractZipSafely, UnsafeZipEntryError } from "./archive.ts";

const attrsFor = (mode: number): number => mode * 0x10000;
const REGULAR = attrsFor(0o100644);
type FixtureEntry = { name: string; data?: string; mode?: number; size?: number };
const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
/** Real stored ZIP records, including malicious names normal ZIP writers reject. */
const zipFixture = (entries: FixtureEntry[]): Buffer => {
  const records = entries.map((entry) => {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? "");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.size ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    return { entry, name, data, local: Buffer.concat([local, name, data]) };
  });
  const directory = records.map((record, index) => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc32(record.data), 16);
    header.writeUInt32LE(record.data.length, 20);
    header.writeUInt32LE(record.entry.size ?? record.data.length, 24);
    header.writeUInt16LE(record.name.length, 28);
    header.writeUInt32LE(attrsFor(record.entry.mode ?? 0o100644), 38);
    header.writeUInt32LE(records.slice(0, index).reduce((sum, item) => sum + item.local.length, 0), 42);
    return Buffer.concat([header, record.name]);
  });
  const body = Buffer.concat(records.map((record) => record.local));
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, end]);
};
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); roots.length = 0; });
const setup = async (entries: FixtureEntry[]) => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-zip-test-"));
  roots.push(root);
  const archive = join(root, "download.zip");
  const dest = join(root, "dest");
  await mkdir(dest);
  await writeFile(archive, zipFixture(entries));
  return { root, archive, dest };
};

describe("assertSafeZipEntry", () => {
  it("accepts regular and nested archive files", () => {
    for (const name of ["uv.exe", "bin/ffmpeg", "package/bin/"]) expect(() => assertSafeZipEntry(name, REGULAR)).not.toThrow();
  });
  it.each(["../evil", "a/../../evil", "a\\evil", "/etc/passwd", "C:/evil", "bin/tool:payload", "a//b", "./tool", "tool.", "CON", "bin/NUL.txt", ""])("rejects unsafe name %s", (name) => {
    expect(() => assertSafeZipEntry(name, REGULAR)).toThrow(UnsafeZipEntryError);
  });
  it.each([0o120777, 0o010644, 0o020644, 0o060644, 0o140644])("rejects nonregular mode %s", (mode) => {
    expect(() => assertSafeZipEntry("entry", attrsFor(mode))).toThrow(UnsafeZipEntryError);
  });
});

describe("extractZipSafely real archives", () => {
  it("merges files and directories, preserves unrelated files and replaces regular files", async () => {
    const { archive, dest } = await setup([{ name: "bin/", mode: 0o040755 }, { name: "bin/tool", data: "executable", mode: 0o100755 }, { name: "old", data: "replacement" }]);
    await writeFile(join(dest, "old"), "old content");
    await writeFile(join(dest, "keep"), "untouched");
    await extractZipSafely(archive, dest);
    expect(await readFile(join(dest, "bin/tool"), "utf8")).toBe("executable");
    expect(await readFile(join(dest, "old"), "utf8")).toBe("replacement");
    expect(await readFile(join(dest, "keep"), "utf8")).toBe("untouched");
    if (process.platform !== "win32") expect((await stat(join(dest, "bin/tool"))).mode & 0o777).toBe(0o755);
  });
  it.each(["../evil", "/evil", "C:/evil", "a\\evil", "tool:payload"])("rejects malicious ZIP path %s before publishing earlier entries", async (name) => {
    const { archive, dest } = await setup([{ name: "innocent", data: "ok" }, { name, data: "attack" }]);
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
  });
  it("rejects symlinks including duplicate symlink/file attack and cleans staging", async () => {
    const { archive, dest, root } = await setup([{ name: "innocent", data: "ok" }, { name: "link", data: "../victim", mode: 0o120777 }, { name: "link", data: "attack" }]);
    await writeFile(join(root, "victim"), "safe");
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    expect(await readFile(join(root, "victim"), "utf8")).toBe("safe");
    expect(await readdir(dest)).toEqual([]);
    expect((await readdir(root)).sort()).toEqual(["dest", "download.zip", "victim"]);
  });
  it("rejects duplicate archive entries", async () => {
    const { archive, dest } = await setup([{ name: "file", data: "one" }, { name: "file", data: "two" }]);
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
  });
  it("rejects an existing file symlink without modifying its target", async () => {
    const { archive, dest, root } = await setup([{ name: "file", data: "attack" }]);
    const victim = join(root, "victim");
    await writeFile(victim, "safe");
    await symlink(victim, join(dest, "file"), "file");
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    expect(await readFile(victim, "utf8")).toBe("safe");
  });
  it("rejects an existing parent junction without modifying outside files", async () => {
    const { archive, dest, root } = await setup([{ name: "bin/file", data: "attack" }]);
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(dest, "bin"), "junction");
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
  it("rejects symlink ancestors of the destination", async () => {
    const { archive, root } = await setup([{ name: "file", data: "attack" }]);
    const outside = join(root, "outside");
    await mkdir(outside);
    const link = join(root, "link");
    await symlink(outside, link, "junction");
    await expect(extractZipSafely(archive, join(link, "child"))).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
  it("rejects excessive declared size and corrupt ZIP, leaving no staged files", async () => {
    const { archive, dest, root } = await setup([{ name: "huge", size: 0xffffffff }]);
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    await writeFile(archive, "invalid zip");
    await expect(extractZipSafely(archive, dest)).rejects.toThrow();
    expect((await readdir(root)).sort()).toEqual(["dest", "download.zip"]);
  });
});
