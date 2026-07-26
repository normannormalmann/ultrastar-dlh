"""CLI des Pipeline-Kerns.

Reihenfolge: tempo (billig) -> separate -> align -> pitch -> notes.
Die drei teuren Stufen sind gecacht, notes nie: es ist billig und genau
das, was justiert wird.
"""

import argparse
import json
import sys
from pathlib import Path

from .align import AlignmentFailed, LanguageUnsupported, align
from .cache import atomic_write_bytes, audio_fingerprint
from .contract import baue_song_data
from .notes import build_notes
from .pitch import track_pitch
from .progress import emit_error, emit_progress
from .separate import separate
from .syllables import has_dictionary
from .tempo import korrigiere_tempo

# Marker, die eine Aufbereitung durch lyrics.ts erfordern. Kopflos wird
# hier nicht geraten — es wird abgebrochen.
UNGELOESTE_MARKER = ("(2x)", "(x2)", "[chorus]", "[refrain]")


def _waehle_device(wunsch: str, warnungen: list[str]) -> str:
    if wunsch != "auto":
        return wunsch
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    warnungen.append("Keine GPU gefunden, Verarbeitung auf CPU (deutlich langsamer).")
    return "cpu"


def _erkenne_bpm(audio: Path) -> float:
    import librosa

    y, sr = librosa.load(str(audio), mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return korrigiere_tempo(float(tempo))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ultrastar_pipeline")
    p.add_argument("--audio", required=True, type=Path)
    p.add_argument("--lyrics-file", required=True, type=Path)
    p.add_argument("--language", required=True)
    p.add_argument("--bpm", type=float, default=None)
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--work-dir", type=Path, default=Path(".pipeline-cache"))
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args(argv)

    warnungen: list[str] = []

    if not args.audio.is_file():
        emit_error("audio_unreadable", path=str(args.audio))
        return 1
    if not args.lyrics_file.is_file():
        emit_error("lyrics_unreadable", path=str(args.lyrics_file))
        return 1

    roh = args.lyrics_file.read_text(encoding="utf8")
    zeilen = [z.strip() for z in roh.splitlines() if z.strip()]
    if not zeilen:
        emit_error("lyrics_empty")
        return 1

    klein = roh.lower()
    gefunden = [m for m in UNGELOESTE_MARKER if m in klein]
    if gefunden:
        emit_error("lyrics_unresolved", markers=gefunden)
        return 1

    if not has_dictionary(args.language):
        warnungen.append(
            f"Keine Silbentrennung fuer '{args.language}', ganze Woerter werden genutzt."
        )

    device = _waehle_device(args.device, warnungen)

    try:
        emit_progress("tempo", 0.0)
        bpm = args.bpm if args.bpm is not None else _erkenne_bpm(args.audio)
        emit_progress("tempo", 1.0)

        fingerprint = audio_fingerprint(args.audio)
        vocals = separate(args.audio, args.work_dir, fingerprint, device)
        woerter = align(vocals, zeilen, args.language, args.work_dir, fingerprint, device)
        verlauf = track_pitch(vocals, args.work_dir, fingerprint)

        # Groesste nicht zugeordnete Luecke: ein Indiz dafuer, dass der
        # Text nicht zum Audio passt (fehlende Strophe, falscher Song).
        luecken = [b.start - a.end for a, b in zip(woerter, woerter[1:])]
        groesste_luecke = max(luecken) if luecken else 0.0

        emit_progress("notes", 0.0)
        noten, umbrueche, gap = build_notes(woerter, verlauf, bpm, args.language)
        emit_progress("notes", 1.0)

    except LanguageUnsupported as exc:
        emit_error("language_unsupported", language=exc.language)
        return 1
    except AlignmentFailed as exc:
        emit_error("alignment_failed", detail=str(exc))
        return 1
    except MemoryError:
        emit_error("device_error", detail="Speicher voll. Mit --device cpu erneut versuchen.")
        return 1
    except Exception as exc:  # noqa: BLE001 - letzte Instanz, strukturiert melden
        art = type(exc).__name__
        # Kein automatisches Ausweichen auf CPU: das verwandelt einen
        # 40-Sekunden-Fehler stillschweigend in zehn Minuten.
        if "OutOfMemory" in art or "out of memory" in str(exc).lower():
            emit_error(
                "device_error", detail="GPU-Speicher voll. Mit --device cpu erneut versuchen."
            )
        else:
            emit_error("pipeline_failed", detail=f"{art}: {exc}")
        return 1

    daten = baue_song_data(
        bpm=bpm,
        gap=gap,
        language=args.language,
        notes=noten,
        line_breaks=umbrueche,
        duration_sec=verlauf[-1].time if verlauf else 0.0,
        device=device,
        stage_versions={"separate": "1", "align": "1", "pitch": "1", "notes": "1"},
        warnings=warnungen,
        largest_gap_sec=groesste_luecke,
    )
    atomic_write_bytes(
        args.out, json.dumps(daten, ensure_ascii=False, indent=2).encode("utf8")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
