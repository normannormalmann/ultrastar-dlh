import { expect, test } from "bun:test";
import { checksumFor } from "./checksum.ts";
test("selects the exact release asset and rejects missing or malformed checksums", () => {
  const hash = "a".repeat(64);
  expect(
    checksumFor(`${"b".repeat(64)}  other.zip\n${hash} *uv.zip\n`, "uv.zip"),
  ).toBe(hash);
  expect(checksumFor(hash, "uv.zip")).toBe(hash);
  expect(() => checksumFor(`${hash}  other.zip`, "uv.zip")).toThrow();
  expect(() => checksumFor("abcd  uv.zip", "uv.zip")).toThrow();
});
