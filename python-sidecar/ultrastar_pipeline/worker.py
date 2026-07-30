"""Worker-Modus: viele Auftraege pro Prozess, Modelle bleiben warm.

Protokoll (Gegenstueck: src/core/create/worker.ts): je stdin-Zeile ein
Auftrag als JSON (Felder wie die CLI-Argumente, camelCase), @@READY nach
dem Start, @@JOB {"id", "ok"} je Auftragsende. Die bestehenden
@@PROGRESS/@@ERROR-Zeilen laufen unveraendert durch - der TS-Demux ordnet
sie dem gerade laufenden Auftrag zu. EOF auf stdin beendet den Worker
sauber. Eine defekte Zeile ist ein @@ERROR plus Weiterlaufen - der Worker
stirbt nicht an einem Tippfehler des Aufrufers.
"""

import json
import sys
from pathlib import Path

from .progress import emit_error
from .verarbeitung import Auftrag, verarbeite_auftrag

READY_MARKER = "@@READY"
JOB_PREFIX = "@@JOB "


def _zu_auftrag(job: dict) -> Auftrag:
    return Auftrag(
        language=str(job["language"]),
        out=Path(str(job["out"])),
        audio=Path(str(job["audio"])) if job.get("audio") else None,
        lyrics_file=Path(str(job["lyricsFile"])) if job.get("lyricsFile") else None,
        bpm=float(job["bpm"]) if job.get("bpm") is not None else None,
        device=str(job.get("device", "auto")),
        work_dir=Path(str(job.get("workDir", ".pipeline-cache"))),
        synced_lyrics=Path(str(job["syncedLyrics"])) if job.get("syncedLyrics") else None,
    )


def run_worker(eingang=None) -> int:
    """Liest Auftraege von `eingang` (Standard: stdin) bis EOF."""
    zeilen = eingang if eingang is not None else sys.stdin
    print(READY_MARKER, flush=True)
    for zeile in zeilen:
        zeile = zeile.strip()
        if not zeile:
            continue
        try:
            job = json.loads(zeile)
            job_id = str(job["id"])
        except (ValueError, KeyError) as exc:
            emit_error("pipeline_failed", detail=f"Unlesbarer Auftrag: {exc}")
            continue
        try:
            ok = verarbeite_auftrag(_zu_auftrag(job)) == 0
        except (ValueError, KeyError, TypeError) as exc:
            # verarbeite_auftrag faengt Pipeline-Fehler selbst; hier landen
            # nur unbrauchbare Feldwerte des Auftrags.
            emit_error("pipeline_failed", detail=f"Unbrauchbarer Auftrag {job_id}: {exc}")
            ok = False
        print(JOB_PREFIX + json.dumps({"id": job_id, "ok": ok}), flush=True)
    return 0
