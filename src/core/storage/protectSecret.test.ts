import { expect, test } from "bun:test";
import { protectSecret } from "./protectSecret.ts";

(process.platform === "win32" ? test : test.skip)(
  "DPAPI round-trips a synthetic password including surrounding spaces",
  async () => {
    const secret = " synthetic test password äöü ";
    const protectedValue = await protectSecret(secret);
    expect(protectedValue).not.toContain(secret);
    expect(await protectSecret(protectedValue, true)).toBe(secret);
    await expect(
      protectSecret("bm90IGEgRFBBUEkgYmxvYg==", true),
    ).rejects.toThrow();
  },
);
