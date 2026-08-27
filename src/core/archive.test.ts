import { describe, expect, it } from "bun:test";
import { assertSafeZipEntry, UnsafeZipEntryError } from "./archive.ts";

/** externalFileAttributes for a given unix mode, the way zip stores it. */
const attrsFor = (mode: number): number => mode * 0x10000;

const REGULAR = attrsFor(0o100644);
const SYMLINK = attrsFor(0o120777);

describe("assertSafeZipEntry", () => {
  it("accepts the flat and nested names our archives actually contain", () => {
    expect(() => assertSafeZipEntry("uv.exe", REGULAR)).not.toThrow();
    expect(() => assertSafeZipEntry("bin/ffmpeg.exe", REGULAR)).not.toThrow();
    expect(() => assertSafeZipEntry("ffmpeg-7.1/bin/", REGULAR)).not.toThrow();
  });

  it("rejects symlink entries, the actual attack vector", () => {
    // A symlink pointing outside the destination turns every later entry
    // into a write outside it - GHSA-jmr9-qjv8-65gv.
    expect(() => assertSafeZipEntry("link", SYMLINK)).toThrow(UnsafeZipEntryError);
  });

  it("rejects names that climb out of the destination", () => {
    expect(() => assertSafeZipEntry("../evil.exe", REGULAR)).toThrow(UnsafeZipEntryError);
    expect(() => assertSafeZipEntry("a/../../evil.exe", REGULAR)).toThrow(UnsafeZipEntryError);
    // Zip stores forward slashes, so a backslash is a deliberate dodge.
    expect(() => assertSafeZipEntry("a\\..\\..\\evil.exe", REGULAR)).toThrow(UnsafeZipEntryError);
  });

  it("rejects absolute names on both platforms", () => {
    expect(() => assertSafeZipEntry("/etc/passwd", REGULAR)).toThrow(UnsafeZipEntryError);
    expect(() => assertSafeZipEntry("C:\\Windows\\System32\\evil.dll", REGULAR)).toThrow(
      UnsafeZipEntryError,
    );
  });

  it("names the offending entry so an install failure is diagnosable", () => {
    expect(() => assertSafeZipEntry("../evil.exe", REGULAR)).toThrow(/\.\.\/evil\.exe/);
  });
});
