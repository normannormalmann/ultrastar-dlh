import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const checksumFor = (manifest: string, filename: string): string => {
  for (const line of manifest.trim().split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/.exec(line.trim());
    if (
      match &&
      (!match[2] || match[2] === filename || match[2] === `./${filename}`)
    )
      return (match[1] as string).toLowerCase();
  }
  throw new Error(`Missing SHA-256 checksum for ${filename}`);
};

export const fetchChecksum = async (
  url: string,
  filename: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> => {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body)
    throw new Error(`Checksum request failed (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new Error("Checksum manifest too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return checksumFor(Buffer.concat(chunks).toString("utf8"), filename);
};

export const verifyFileChecksum = async (
  path: string,
  expected: string,
): Promise<void> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== expected)
    throw new Error(
      "SHA-256 mismatch: refusing to install downloaded executable",
    );
};
