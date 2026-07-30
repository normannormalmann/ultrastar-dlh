"""Modul-Level-Caches fuer Modell-Handles.

Im Ein-Auftrag-CLI ist das Neuladen je Aufruf egal - der Prozess stirbt
danach. Im Worker (viele Auftraege pro Prozess) ist genau dieses Cachen
der Kern des Warm-Vorteils: ab dem zweiten Song entfallen 30-60 s
Ladezeit. Muster aus UltraStarKaraokeMaker (MIT, (c) walterfr).

Die Modelle sind zwischen Auftraegen zustandslos (transcribe/align halten
nichts vom vorherigen Song), darum ist das Cachen gefahrlos.
"""

from typing import Any

_asr: dict[tuple[str, str, str], Any] = {}
_align: dict[tuple[str, str], Any] = {}
_demucs: dict[str, Any] = {}
_swiftf0: list[Any] = []


def hole_asr(modell: str, device: str, sprache: str) -> Any:
    schluessel = (modell, device, sprache)
    if schluessel not in _asr:
        import whisperx

        _asr[schluessel] = whisperx.load_model(
            modell,
            device,
            compute_type="float16" if device == "cuda" else "int8",
            language=sprache,
        )
    return _asr[schluessel]


def hole_align(sprache: str, device: str) -> Any:
    schluessel = (sprache, device)
    if schluessel not in _align:
        import whisperx

        _align[schluessel] = whisperx.load_align_model(
            language_code=sprache, device=device
        )
    return _align[schluessel]


def hole_demucs(name: str) -> Any:
    if name not in _demucs:
        from demucs.pretrained import get_model

        _demucs[name] = get_model(name)
    return _demucs[name]


def hole_swiftf0() -> Any:
    if not _swiftf0:
        from swift_f0 import SwiftF0

        _swiftf0.append(SwiftF0())
    return _swiftf0[0]


def leere_caches() -> None:
    """Nur fuer Tests: haelt die Testlaeufe unabhaengig voneinander."""
    _asr.clear()
    _align.clear()
    _demucs.clear()
    _swiftf0.clear()
