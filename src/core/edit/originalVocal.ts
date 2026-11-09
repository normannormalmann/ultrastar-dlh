export const ORIGINAL_PITCH_FILE = "originalPitch.json";
export const VOCALS_FILE = "vocals.wav";
export type OriginalPitch = {
  midiOffset: number;
  sourceHash?: string;
  analysisVersion?: string;
  vocalFile?: string;
  points: { ms: number; pitch: number }[];
};

/** Bound the IPC payload and reject malformed analysis files from imported folders. */
export const parseOriginalPitch = (value: unknown): OriginalPitch | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<OriginalPitch>;
  if (v.midiOffset !== 48 && v.midiOffset !== 60) return null;
  if (!Array.isArray(v.points) || v.points.length > 500_000) return null;
  let previous = -1;
  for (const point of v.points) {
    if (
      !point ||
      !Number.isFinite(point.ms) ||
      !Number.isFinite(point.pitch) ||
      point.ms < previous ||
      Math.abs(point.pitch) > 200
    )
      return null;
    previous = point.ms;
  }
  return {
    midiOffset: v.midiOffset,
    points: v.points,
    sourceHash:
      typeof v.sourceHash === "string" && /^[a-f0-9]{64}$/.test(v.sourceHash)
        ? v.sourceHash
        : undefined,
    analysisVersion:
      typeof v.analysisVersion === "string"
        ? v.analysisVersion.slice(0, 128)
        : undefined,
    vocalFile:
      typeof v.vocalFile === "string" &&
      /^vocals-[a-f0-9-]+\.wav$/.test(v.vocalFile)
        ? v.vocalFile
        : undefined,
  };
};
