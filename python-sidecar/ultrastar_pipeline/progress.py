"""Fortschritts- und Fehlerkanal.

torch, Demucs und WhisperX schreiben reichlich eigenen Text, teils auf
stdout. Reines JSON-Lines waere damit nicht verlaesslich parsebar, deshalb
werden unsere Zeilen mit einem Marker praefigiert. TypeScript filtert
darauf, alles andere gilt als Log.
"""

import json
import sys
from typing import Any

PROGRESS_PREFIX = "@@PROGRESS "
ERROR_PREFIX = "@@ERROR "


def _schreibe(prefix: str, nutzlast: dict[str, Any]) -> None:
    # Kompaktes JSON ohne Zeilenumbruch: eine Meldung ist genau eine Zeile.
    zeile = json.dumps(nutzlast, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write(f"{prefix}{zeile}\n")
    sys.stdout.flush()


def emit_progress(stage: str, percent: float) -> None:
    """Fortschritt einer Stufe melden. percent wird auf 0..1 begrenzt."""
    _schreibe(
        PROGRESS_PREFIX,
        {"stage": stage, "percent": min(1.0, max(0.0, float(percent)))},
    )


def emit_error(kind: str, **felder: Any) -> None:
    """Strukturierten Fehler melden, damit TS ihn typisiert abbilden kann."""
    _schreibe(ERROR_PREFIX, {"kind": kind, **felder})
