import { open, readFile, type FileHandle } from "node:fs/promises";

type TextHandle = Pick<FileHandle, "stat" | "readFile" | "close">;
type OpenTextFile = (path: string, flags: number) => Promise<TextHandle>;

export const readRegularText = async (
  path: string,
  openFile: OpenTextFile = open,
): Promise<string | null> => {
  const handle = await openFile(path, 0);
  try {
    if (!(await handle.stat()).isFile()) return null;
    return await readFile(path, "utf8");
  } finally {
    await handle.close();
  }
};
