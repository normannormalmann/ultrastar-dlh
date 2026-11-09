"""Pitch tracking: SwiftF0 by default, CREPE and consensus as opt-in comparisons."""

import json
import math
from pathlib import Path
from statistics import median
from typing import Any

from . import modelle, modellwahl, separate
from .cache import atomic_write_bytes, stage_path
from .notes import PitchPoint
from .progress import emit_progress

STAGE_VERSION = "3"

SWIFTF0 = "swift-f0"
TORCHCREPE = "torchcrepe-full"
CONSENSUS = "swift-f0-consensus"

# Preserve the original frequency range, decoder and periodicity threshold.
# Decoder batch size, silence gating and RNG seed are explicit cache inputs.
TORCHCREPE_PARAMETER: dict[str, Any] = {
    "modell": "full",
    "hop_ms": 10,
    "fmin_hz": 65.0,
    "fmax_hz": 1100.0,
    "decoder": "viterbi",
    "periodicity_medianfenster": 3,
    "stimmhaft_ab": 0.21,
    # Viterbi is decoded per batch: fix this across CPU and CUDA.
    "batch_frames": 512,
    "silence_rms_db": -60.0,
    "dither_seed": 0,
}


def _hz_zu_midi(hz: float) -> float:
    """Frequenz in MIDI-Halbtoene. 0 bedeutet: keine Tonhoehe."""
    if hz <= 0:
        return 0.0
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def _cache_parameter() -> dict[str, Any]:
    """Record algorithm choices; the stage version invalidates older output schemas."""
    parameter: dict[str, Any] = {
        # Ohne diesen Eintrag liefert ein getauschtes Tonhoehenmodell still
        # den Verlauf des alten aus dem Cache.
        "pitch_model": modellwahl.PITCH,
        # Die Identitaet der separate-Stufe geht in den Schluessel ein: sonst
        # wuerde eine geanderte Stimmtrennung (neues Modell, neue Version)
        # einen Tonhoehenverlauf wiederverwenden, der noch auf dem alten
        # Stem beruht.
        "separate_stage_version": separate.STAGE_VERSION,
        "separate_model": separate.MODELL,
    }
    if modellwahl.PITCH in (TORCHCREPE, CONSENSUS):
        parameter["torchcrepe"] = dict(TORCHCREPE_PARAMETER)
    if modellwahl.PITCH == CONSENSUS:
        from .pitchConsensus import PARAMETERS
        parameter["consensus"] = dict(PARAMETERS)
    return parameter


def _medianfilter(werte: list[float], fenster: int) -> list[float]:
    """Gleitender Median wie torchcrepe.filter.median: Reflect-Padding an
    den Raendern, Fenster ungerade. Fenster 1 laesst die Werte unveraendert."""
    if fenster <= 1 or len(werte) < 2:
        return list(werte)
    rand = fenster // 2
    # Reflect wie torch.nn.functional.pad(mode="reflect"): spiegelt ohne
    # den Randwert selbst (x[1], x[2], ... links; x[-2], x[-3], ... rechts).
    links = [werte[min(i, len(werte) - 1)] for i in range(rand, 0, -1)]
    rechts = [werte[max(len(werte) - 1 - i, 0)] for i in range(1, rand + 1)]
    gepolstert = links + list(werte) + rechts
    return [median(gepolstert[i : i + fenster]) for i in range(len(werte))]


def _torchcrepe_punkte(
    f0_hz: list[float],
    periodicity: list[float],
    hop_s: float,
    medianfenster: int,
    stimmhaft_ab: float,
    rms: list[float] | None = None,
) -> list[PitchPoint]:
    """Rohausgabe von torchcrepe in PitchPoints: Zeit = Frame * Hop,
    stimmhaft genau dann, wenn die mediangefilterte Periodicity den
    Schwellwert erreicht. Rein, damit die Regel ohne Modell testbar ist."""
    geglaettet = _medianfilter(periodicity, medianfenster)
    return [
        PitchPoint(
            time=i * hop_s,
            midi=_hz_zu_midi(float(hz)),
            voiced=bool(math.isfinite(hz) and hz > 0 and math.isfinite(p) and p >= stimmhaft_ab
                        and (rms is None or rms[i] >= 10 ** (TORCHCREPE_PARAMETER["silence_rms_db"] / 20))),
            confidence=float(p) if math.isfinite(p) and 0 <= p <= 1 else 0.0,
            source="torchcrepe",
        )
        for i, (hz, p) in enumerate(zip(f0_hz, geglaettet, strict=True))
    ]


def _verlauf_swiftf0(vocals: Path) -> list[PitchPoint]:
    # SwiftF0 ist eine Klasse, keine Funktion, und PitchResult liefert die
    # Stimmhaftigkeit schon als Wahrheitswert pro Frame — ein zweiter Aufruf
    # dafuer existiert nicht. Felder: pitch_hz, confidence, timestamps, voicing.
    ergebnis = modelle.hole_swiftf0().detect_from_file(str(vocals))
    return [
        PitchPoint(time=float(t), midi=_hz_zu_midi(float(f)), voiced=bool(v),
                   confidence=float(c), source="swift-f0")
        for t, f, v, c in zip(
            ergebnis.timestamps, ergebnis.pitch_hz, ergebnis.voicing, ergebnis.confidence, strict=True
        )
    ]


def _verlauf_torchcrepe(vocals: Path, device: str) -> list[PitchPoint]:
    """torchcrepe ueber den Gesangs-Stem. Importe lokal: das Paket liegt im
    Versuch ausserhalb der App-Umgebung (PYTHONPATH), die Stufe darf ohne
    es importierbar bleiben."""
    import torch
    import torchcrepe
    import numpy as np
    from .modelBackend import load_audio, SAMPLE_RATE

    p = TORCHCREPE_PARAMETER
    # Use the common 16 kHz clock; torchcrepe truncates fractional hops when
    # resampling other rates, which would otherwise accumulate timestamp drift.
    rate = SAMPLE_RATE
    mono = torch.from_numpy(load_audio(str(vocals))).unsqueeze(0)
    hop = int(round(rate * p["hop_ms"] / 1000))
    decoder = {"viterbi": torchcrepe.decode.viterbi, "argmax": torchcrepe.decode.argmax}[
        p["decoder"]
    ]
    # torchcrepe dithers decoded bins with NumPy's global RNG. Keep comparisons
    # reproducible without changing the random state used by other stages.
    rng_state = np.random.get_state()
    try:
        np.random.seed(p["dither_seed"])
        f0, periodicity = torchcrepe.predict(
            mono, rate, hop_length=hop, fmin=p["fmin_hz"], fmax=p["fmax_hz"],
            model=p["modell"], decoder=decoder, return_periodicity=True,
            batch_size=p["batch_frames"], device=device,
        )
    finally:
        np.random.set_state(rng_state)
    # Level gate on the original signal; normalized model frames can turn
    # silence into confident pitch. Match each frame's 64 ms analysis window.
    values = mono[0].numpy().astype(np.float64)
    squared = np.r_[0.0, np.cumsum(values * values)]
    centers = np.arange(f0.shape[1]) * hop
    radius = int(round(rate * .032))
    left, right = np.maximum(0, centers - radius), np.minimum(len(values), centers + radius)
    rms = np.sqrt((squared[right] - squared[left]) / np.maximum(1, right - left))
    return _torchcrepe_punkte(
        f0[0].tolist(),
        periodicity[0].tolist(),
        hop / rate,
        p["periodicity_medianfenster"],
        p["stimmhaft_ab"],
        rms.tolist(),
    )


def preload_pitch(device: str) -> None:
    if modellwahl.PITCH not in (SWIFTF0, TORCHCREPE, CONSENSUS):
        raise ValueError(f"Unbekanntes Tonhoehenmodell {modellwahl.PITCH!r}")
    if modellwahl.PITCH in (SWIFTF0, CONSENSUS):
        modelle.hole_swiftf0()
    if modellwahl.PITCH in (TORCHCREPE, CONSENSUS):
        import torchcrepe
        torchcrepe.load.model(device, "full")


def _validate_points(points: list[PitchPoint]) -> None:
    previous = -1.0
    for point in points:
        if (not math.isfinite(point.time) or point.time < 0 or point.time <= previous
                or not math.isfinite(point.midi) or (point.voiced and point.midi <= 0)
                or (point.confidence is not None and
                    (not math.isfinite(point.confidence) or not 0 <= point.confidence <= 1))):
            raise ValueError("Tonhoehenmodell lieferte ungueltige Messwerte")
        previous = point.time


def track_pitch(
    vocals: Path, work_dir: Path, audio_hash: str, device: str = "cpu"
) -> list[PitchPoint]:
    """f0-Verlauf der Gesangsspur, in MIDI-Halbtoenen."""
    if modellwahl.PITCH not in (SWIFTF0, TORCHCREPE, CONSENSUS):
        # Ein Tippfehler in USC_PITCH darf nicht still SwiftF0 rechnen und
        # das Ergebnis unter dem falschen Namen cachen.
        raise ValueError(
            f"Unbekanntes Tonhoehenmodell {modellwahl.PITCH!r}; "
            f"bekannt: {SWIFTF0!r}, {TORCHCREPE!r}, {CONSENSUS!r}"
        )

    ziel = stage_path(
        work_dir, audio_hash, "pitch", _cache_parameter(), STAGE_VERSION, ".json"
    )
    if ziel.is_file():
        emit_progress("pitch", 1.0)
        points = [PitchPoint(**p) for p in json.loads(ziel.read_text(encoding="utf8"))]
        _validate_points(points)
        return points

    emit_progress("pitch", 0.0)

    if modellwahl.PITCH == TORCHCREPE:
        punkte = _verlauf_torchcrepe(vocals, device)
    else:
        punkte = _verlauf_swiftf0(vocals)
        if modellwahl.PITCH == CONSENSUS:
            from .pitchConsensus import merge_pitch
            _validate_points(punkte)
            secondary = _verlauf_torchcrepe(vocals, device)
            _validate_points(secondary)
            punkte = merge_pitch(punkte, secondary)

    _validate_points(punkte)
    atomic_write_bytes(ziel, json.dumps([p.__dict__ for p in punkte]).encode("utf8"))
    emit_progress("pitch", 1.0)
    return punkte
