"""CLI des Pipeline-Kerns.

Reihenfolge: tempo (billig) -> separate -> transcribe -> anchors -> align ->
pitch -> notes. Die vier teuren Stufen sind gecacht, notes nie: es ist
billig und genau das, was justiert wird.

Preload-Modus: laedt alle vier Modellarten einmal, um die Umgebungs-Einrichtung
zu proben - vor dem ersten echten Lauf.
"""

import argparse
import sys
from pathlib import Path

from . import preload as preload_modul
from .align import LanguageUnsupported
from .progress import emit_error
from .verarbeitung import (
    Auftrag,
    _baue_sections,
    _wende_lrc_an,
    _waehle_device,
    verarbeite_auftrag,
)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ultrastar_pipeline")
    p.add_argument("--audio", type=Path)
    p.add_argument("--lyrics-file", type=Path)
    p.add_argument("--language", required=True)
    p.add_argument("--bpm", type=float, default=None)
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--work-dir", type=Path, default=Path(".pipeline-cache"))
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--synced-lyrics", type=Path, default=None)
    p.add_argument("--preload", action="store_true")
    args = p.parse_args(argv)

    warnungen: list[str] = []

    device = _waehle_device(args.device, warnungen)

    if args.preload:
        # Probelauf der Umgebungs-Einrichtung: Modelle laden, Ergebnis
        # schreiben, fertig. Die Ausnahme-Uebersetzung entspricht der
        # bestehenden Fehlerleitung des echten Laufs.
        try:
            preload_modul.preload(args.language, device, args.out)
        except LanguageUnsupported as exc:
            emit_error("language_unsupported", language=exc.language, stufe=exc.stufe)
            return 1
        except ModuleNotFoundError as exc:
            emit_error("env_missing", module=exc.name)
            return 1
        except Exception as exc:  # noqa: BLE001 - letzte Instanz
            art = type(exc).__name__
            if "OutOfMemory" in art or "out of memory" in str(exc).lower():
                emit_error("device_error", detail="GPU-Speicher voll. Mit --device cpu erneut versuchen.")
            else:
                emit_error("pipeline_failed", detail=f"{art}: {exc}")
            return 1
        return 0

    return verarbeite_auftrag(
        Auftrag(
            audio=args.audio,
            lyrics_file=args.lyrics_file,
            language=args.language,
            bpm=args.bpm,
            device=args.device,
            work_dir=args.work_dir,
            out=args.out,
            synced_lyrics=args.synced_lyrics,
        )
    )


if __name__ == "__main__":
    sys.exit(main())
