"""CLI des Pipeline-Kerns.

Reihenfolge: tempo (billig) -> separate -> transcribe -> align -> pitch -> notes.
Die vier teuren Stufen sind gecacht, notes nie: es ist billig und genau
das, was justiert wird.
"""

import argparse
import json
import sys
from pathlib import Path

from . import anchors, transcribe
from .align import (
    STAGE_VERSION as ALIGN_STAGE_VERSION,
    AlignmentFailed,
    LanguageUnsupported,
    align,
    dauer_oder_rueckfall,
    dauer_sekunden,
)
from .cache import atomic_write_bytes, audio_fingerprint
from .contract import baue_song_data
from .notes import build_notes
from .pitch import STAGE_VERSION as PITCH_STAGE_VERSION, track_pitch
from .progress import emit_error, emit_progress
from .separate import STAGE_VERSION as SEPARATE_STAGE_VERSION, separate
from .syllables import has_dictionary
from .tempo import korrigiere_tempo
from .transcribe import STAGE_VERSION as TRANSCRIBE_STAGE_VERSION

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
    import numpy as np

    y, sr = librosa.load(str(audio), mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    # librosa 0.11 liefert das Tempo als Array, nicht als Skalar, und unter
    # NumPy 2 wirft float() auf ein Array mit einem Element. Erst flach
    # machen, dann den ersten Wert nehmen — deckt Skalar und Array ab.
    werte = np.asarray(tempo).reshape(-1)
    if werte.size == 0:
        raise ValueError("Tempoerkennung lieferte keinen Wert")
    return korrigiere_tempo(float(werte[0]))


def _stage_versions() -> dict[str, str]:
    """Stufenversionen fuer den Bericht, aus den Modulen selbst — nicht
    hartkodiert, damit eine Versionsbumpe in separate/transcribe/align/pitch
    hier automatisch ankommt. notes wird nie gecacht (siehe Modulkopf) und
    hat darum keine eigene STAGE_VERSION."""
    return {
        "separate": SEPARATE_STAGE_VERSION,
        "transcribe": TRANSCRIBE_STAGE_VERSION,
        "align": ALIGN_STAGE_VERSION,
        "pitch": PITCH_STAGE_VERSION,
        "notes": "1",
    }


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

    # Bekannte Lücke, absichtlich ungefixt: dieser Scan findet nur die
    # literalen Marker selbst. Liedtext, der von lyrics.ts schon normalisiert
    # wurde, dessen offene Rueckfragen aber nie beantwortet wurden, sieht in
    # einer reinen .txt-Datei identisch zu geklaertem Text aus — dieser
    # Zustand ist hier nicht repraesentierbar. Gehoert zum UI-Teilprojekt.
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

        transkript = transcribe.transcribe(vocals, args.language, args.work_dir, fingerprint, device)
        flach = [wort for zeile in zeilen for wort in zeile.split()]
        anker = anchors.finde_anker(flach, transkript)
        # Kein Rueckfallwert hier: die Datei hat separate() gerade selbst
        # geschrieben, ist sie nicht lesbar, ist das ein echter Defekt und
        # soll als solcher hochkommen (der generische except-Zweig unten
        # faengt ihn strukturiert ab) statt als vorgetaeuschte Songlaenge
        # 0.0 zu erscheinen, an der baue_abschnitte mit einer irrefuehrenden
        # Fehlermeldung scheitern wuerde.
        abschnitte = anchors.baue_abschnitte(len(flach), anker, dauer_sekunden(vocals))
        # Ein schwacher Abschnitt darf nicht still bleiben. Unterhalb der
        # Haelfte wiedergefundener Woerter ist ein Abschnitt eher geraten als
        # verankert.
        schwach = [a for a in abschnitte if a.vertrauen < 0.5]
        if schwach:
            warnungen.append(
                f"{len(schwach)} von {len(abschnitte)} Abschnitten konnten nur unsicher "
                "verankert werden; die Zeitstempel dort sind weniger verlaesslich."
            )

        woerter = align(
            vocals,
            zeilen,
            args.language,
            args.work_dir,
            fingerprint,
            device,
            warnungen,
            abschnitte,
        )
        verlauf = track_pitch(vocals, args.work_dir, fingerprint)

        # Groesste nicht zugeordnete Luecke: ein Indiz dafuer, dass der
        # Text nicht zum Audio passt (fehlende Strophe, falscher Song).
        luecken = [b.start - a.end for a, b in zip(woerter, woerter[1:])]
        # Ueberlappende oder unsortierte Woerter koennten eine negative
        # Luecke ergeben; das waere kein Indiz, sondern nur Rauschen.
        groesste_luecke = max(0.0, max(luecken)) if luecken else 0.0

        emit_progress("notes", 0.0)
        noten, umbrueche, gap = build_notes(woerter, verlauf, bpm, args.language)
        emit_progress("notes", 1.0)

    except LanguageUnsupported as exc:
        emit_error("language_unsupported", language=exc.language, stufe=exc.stufe)
        return 1
    except AlignmentFailed as exc:
        emit_error("alignment_failed", detail=str(exc))
        return 1
    except MemoryError:
        emit_error("device_error", detail="Speicher voll. Mit --device cpu erneut versuchen.")
        return 1
    except ModuleNotFoundError as exc:
        # Bei weitem der wahrscheinlichste Fehler, solange die Modell-Extras
        # nicht installiert sind — muss deshalb vor dem generischen Fall
        # abgefangen werden, sonst verschwindet der Paketname darin.
        emit_error("env_missing", module=exc.name)
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

    # Der letzte Zeitstempel des Tonhoehenverlaufs bleibt der Rueckfall: die
    # echte WAV-Laenge (aus vocals, der garantiert eine WAV ist) ist genauer,
    # aber nicht in jedem Umfeld lesbar.
    dauer = dauer_oder_rueckfall(vocals, verlauf[-1].time if verlauf else 0.0)

    daten = baue_song_data(
        bpm=bpm,
        gap=gap,
        language=args.language,
        notes=noten,
        line_breaks=umbrueche,
        duration_sec=dauer,
        device=device,
        stage_versions=_stage_versions(),
        warnings=warnungen,
        largest_gap_sec=groesste_luecke,
    )
    atomic_write_bytes(
        args.out, json.dumps(daten, ensure_ascii=False, indent=2).encode("utf8")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
