import { constants } from "node:fs";
import { open } from "node:fs/promises";

type TextHandle = {
  stat(): Promise<{ isFile(): boolean }>;
  readFile(encoding: "utf8"): Promise<string>;
  close(): Promise<void>;
};
type OpenTextFile = (path: string, flags: number) => Promise<TextHandle>;

/**
 * Inspect and read one opened descriptor, so replacing its path cannot change
 * the inspected file. O_NOFOLLOW also rejects final symlinks on supporting OSes;
 * Windows has no atomic no-follow equivalent in Node. Parent directories must
 * be trusted. O_NONBLOCK avoids waiting on FIFOs before the regular-file check.
 */
export const readRegularText = async (
  path: string,
  openFile: OpenTextFile = open,
): Promise<string | null> => {
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  const handle = await openFile(path, flags);
  try {
    if (!(await handle.stat()).isFile()) return null;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
};
