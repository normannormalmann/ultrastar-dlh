import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

const pending = new Map<string, Promise<unknown>>();

/** Serialize read/modify/write transactions by path; a failure never poisons the next write. */
export const serializeFile = <T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const next = (pending.get(path) ?? Promise.resolve())
    .catch(() => {})
    .then(operation);
  pending.set(path, next);
  void next
    .finally(() => {
      if (pending.get(path) === next) pending.delete(path);
    })
    .catch(() => {});
  return next;
};

/** A unique sibling temporary file keeps the previous file intact on failed writes. */
export const atomicWrite = async (
  path: string,
  contents: string,
): Promise<void> => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};

export const writeJson = (path: string, value: unknown): Promise<void> => {
  const snapshot = JSON.stringify(value, null, 2);
  return serializeFile(path, () => atomicWrite(path, snapshot));
};

export const flushWrites = async (): Promise<void> => {
  await Promise.all([...pending.values()]);
};
