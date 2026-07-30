const UMLAUT_MAP: Record<string, string> = {
  ä: "ae",
  Ä: "Ae",
  ö: "oe",
  Ö: "Oe",
  ü: "ue",
  Ü: "Ue",
  ß: "ss",
};

/**
 * Securely sanitizes a string for use in file paths.
 * Prevents path traversal, injection, and other attacks.
 * Pure (no node: imports) — also usable in the renderer, to derive the
 * download folder name from "Artist - Title".
 */
export const sanitizeForPath = (name: string): string => {
  // Remove NUL-bytes and control characters (0x00-0x1f and 0x80-0x9f)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional - stripping control chars for path safety
  let cleaned = name.replace(/[\x00-\x1f\x80-\x9f]/g, "");

  // Limit length to prevent buffer overflow attacks (Windows MAX_PATH is 260, but we're conservative)
  const MAX_LENGTH = 100;
  cleaned = cleaned.slice(0, MAX_LENGTH);

  // Replace umlauts
  cleaned = cleaned.replace(/[äÄöÖüÜß]/g, (c) => UMLAUT_MAP[c] ?? c);

  // Replace dangerous characters with underscore (instead of space)
  // This prevents: directory traversal, command injection, etc.
  cleaned = cleaned.replace(/[\\/:"*?<>|]/g, "_");

  // Remove parent directory traversal sequences explicitly
  cleaned = cleaned.replace(/\.\./g, "");

  // Remove leading/trailing dots and spaces
  cleaned = cleaned.trim().replace(/^\.+|\.+$/g, "");

  // Collapse multiple underscores/spaces into single underscore
  cleaned = cleaned.replace(/[_\s]+/g, "_");

  // Pure basename equivalent (separators are already replaced above; safety net)
  let sanitized = cleaned.split(/[\\/]/).pop() ?? "";

  // Final safety check: if empty after sanitization, use a default name
  if (!sanitized || sanitized.length === 0) {
    sanitized = "unnamed";
  }

  return sanitized;
};

export type FolderLayout = "flat" | "artist" | "letter";

/** Letter bucket of the sanitized artist: A–Z, otherwise "#". */
const letterBucket = (artist: string): string => {
  const first = sanitizeForPath(artist).charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
};

/**
 * Relative song path under the download folder (with "/" as separator;
 * node:path join normalizes it per-platform). The leaf name is identical
 * across all layouts — an invariant for dirName dedupe and the ✓ marker.
 */
export const songRelativePath = (
  artist: string,
  title: string,
  layout: FolderLayout,
): string => {
  const leaf = sanitizeForPath(`${artist} - ${title}`);
  switch (layout) {
    case "artist":
      return `${sanitizeForPath(artist)}/${leaf}`;
    case "letter":
      return `${letterBucket(artist)}/${leaf}`;
    default:
      return leaf;
  }
};
