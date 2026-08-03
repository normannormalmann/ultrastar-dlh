// src/core/create/job.ts
// One queued song creation. Lives in core rather than in the IPC contract
// because core/storage persists it: core must not depend on desktop/.
import type { MediaQuelle } from "./media.ts";

export type CreateJob = {
  id: string;
  quelle: MediaQuelle;
  language: string;
  /** artist/title also drive the folder name. */
  artist: string;
  title: string;
  /** The resolved lines, joined by "\n". creations.ts writes them to the job dir. */
  lyricsText: string;
  /** LRCLIB's .lrc, if there was a hit - the second evidence source. */
  syncedLyricsText?: string;
  /** Step 4's result. Absent means "decide automatically", NOT "no image". */
  coverWahl?: { pfad: string } | "keins";
  genre?: string;
  year?: number;
  bpm?: number;
};
