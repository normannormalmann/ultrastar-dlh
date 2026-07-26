"""Zwischenstufen-Cache.

Geschluesselt ueber den Audio-INHALT, nicht den Pfad — dieselbe Datei an
anderer Stelle trifft denselben Cache. Stufenparameter und Stufenversion
gehen mit ein, damit eine Codeaenderung den Cache invalidiert.

Geschrieben wird erst nach .tmp und dann umbenannt, damit ein Abbruch den
Cache nicht vergiftet. Dasselbe Muster nutzt desktop/main/binaries.ts.
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

_BLOCK = 1024 * 1024


def audio_fingerprint(path: Path) -> str:
    """SHA-256 ueber den Dateiinhalt, blockweise gelesen."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(_BLOCK):
            h.update(block)
    return h.hexdigest()[:16]


def _param_hash(params: dict[str, Any], stage_version: str) -> str:
    roh = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{roh}|{stage_version}".encode()).hexdigest()[:8]


def stage_path(
    work_dir: Path,
    audio_hash: str,
    stage: str,
    params: dict[str, Any],
    stage_version: str,
    suffix: str,
) -> Path:
    """Zielpfad fuer das Ergebnis einer Stufe."""
    return work_dir / audio_hash / f"{stage}-{_param_hash(params, stage_version)}{suffix}"


def atomic_write_bytes(target: Path, daten: bytes) -> None:
    """Erst nach .tmp schreiben, dann umbenennen.

    Der Tempname ist pro Aufruf eindeutig (PID + Zufallsanteil): zwei
    gleichzeitige Schreiber auf denselben Zielpfad — etwa zwei Jobs der
    Desktop-Warteschlange ueber derselben Audiodatei, oder ein Retry waehrend
    ein frueherer Lauf noch schreibt — teilen sich sonst dieselbe Tempdatei,
    und ihre Schreibvorgaenge koennten sich vor der Umbenennung vermischen.
    with_name statt with_suffix, damit ein Dateiname mit mehreren Punkten
    korrekt behandelt wird.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.{os.getpid()}-{uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(daten)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
