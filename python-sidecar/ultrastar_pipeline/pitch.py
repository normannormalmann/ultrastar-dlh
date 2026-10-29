"""Tonhoehenverlauf. Zwei Backends hinter USC_PITCH (modellwahl.PITCH):
SwiftF0 als Standard, torchcrepe als Vergleichsarm."""

import json
import math
from pathlib import Path
from statistics import median
from typing import Any

from . import modelle, modellwahl, separate
from .cache import atomic_write_bytes, stage_path
from .notes import PitchPoint
from .progress import emit_progress

STAGE_VERSION = "2"

SWIFTF0 = "swift-f0"
TORCHCREPE = "torchcrepe-full"

# Vor dem Messlauf festgelegt (29.10.2026) und danach nicht mehr gedreht.
# Der Stimmhaftigkeits-Schwellwert entscheidet ueber notes._mittlere_tonhoehe
# (nimmt nur stimmhafte Frames), welche Frames in den Ton eingehen — und
# zwar unabhaengig von der Pitch-Guete des Modells. Wer ihn nachtraeglich
# justiert, findet immer eine Einstellung, die den Vergleich gewinnt.
# Modell, Hop, Bereich, Decoder und Filter sind die Standardwerte aus dem
# torchcrepe-README, der Bereich auf Gesang eingeengt.
TORCHCREPE_PARAMETER: dict[str, Any] = {
    "modell": "full",
    "hop_ms": 10,
    "fmin_hz": 65.0,
    "fmax_hz": 1100.0,
    "decoder": "viterbi",
    "periodicity_medianfenster": 3,
    "stimmhaft_ab": 0.21,
}

# Frames je Durchlauf durch das Netz. Aendert nur Speicher und Laufzeit,
# nicht das Ergebnis — darum nicht im Cache-Schluessel.
_TORCHCREPE_BATCH = {"cuda": 2048, "cpu": 512}


def _hz_zu_midi(hz: float) -> float:
    """Frequenz in MIDI-Halbtoene. 0 bedeutet: keine Tonhoehe."""
    if hz <= 0:
        return 0.0
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def _cache_parameter() -> dict[str, Any]:
    """Schluesselparameter der Stufe.

    Fuer SwiftF0 bleibt der Satz exakt so, wie er die bestehenden Caches
    erzeugt hat — ein neuer Eintrag wuerde jeden Basislauf neu rechnen
    lassen. Fuer torchcrepe gehen die eingefrorenen Parameter mit hinein:
    sonst liefert ein spaeterer Versuch mit anderem Hop oder Schwellwert
    still den alten Verlauf aus dem Cache.
    """
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
    if modellwahl.PITCH == TORCHCREPE:
        parameter["torchcrepe"] = dict(TORCHCREPE_PARAMETER)
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
) -> list[PitchPoint]:
    """Rohausgabe von torchcrepe in PitchPoints: Zeit = Frame * Hop,
    stimmhaft genau dann, wenn die mediangefilterte Periodicity den
    Schwellwert erreicht. Rein, damit die Regel ohne Modell testbar ist."""
    geglaettet = _medianfilter(periodicity, medianfenster)
    return [
        PitchPoint(
            time=i * hop_s,
            midi=_hz_zu_midi(float(hz)),
            voiced=bool(p >= stimmhaft_ab),
        )
        for i, (hz, p) in enumerate(zip(f0_hz, geglaettet, strict=True))
    ]


def _verlauf_swiftf0(vocals: Path) -> list[PitchPoint]:
    # SwiftF0 ist eine Klasse, keine Funktion, und PitchResult liefert die
    # Stimmhaftigkeit schon als Wahrheitswert pro Frame — ein zweiter Aufruf
    # dafuer existiert nicht. Felder: pitch_hz, confidence, timestamps, voicing.
    ergebnis = modelle.hole_swiftf0().detect_from_file(str(vocals))
    return [
        PitchPoint(time=float(t), midi=_hz_zu_midi(float(f)), voiced=bool(v))
        for t, f, v in zip(
            ergebnis.timestamps, ergebnis.pitch_hz, ergebnis.voicing, strict=False
        )
    ]


def _verlauf_torchcrepe(vocals: Path, device: str) -> list[PitchPoint]:
    """torchcrepe ueber den Gesangs-Stem. Importe lokal: das Paket liegt im
    Versuch ausserhalb der App-Umgebung (PYTHONPATH), die Stufe darf ohne
    es importierbar bleiben."""
    import soundfile
    import torch
    import torchcrepe

    p = TORCHCREPE_PARAMETER
    daten, rate = soundfile.read(str(vocals), dtype="float32", always_2d=True)
    # Stem ist stereo; torchcrepe erwartet (1, Zeit) mono.
    mono = torch.from_numpy(daten.mean(axis=1)).unsqueeze(0)
    hop = int(round(rate * p["hop_ms"] / 1000))
    decoder = {"viterbi": torchcrepe.decode.viterbi, "argmax": torchcrepe.decode.argmax}[
        p["decoder"]
    ]
    f0, periodicity = torchcrepe.predict(
        mono,
        rate,
        hop_length=hop,
        fmin=p["fmin_hz"],
        fmax=p["fmax_hz"],
        model=p["modell"],
        decoder=decoder,
        return_periodicity=True,
        batch_size=_TORCHCREPE_BATCH.get(device, _TORCHCREPE_BATCH["cpu"]),
        device=device,
    )
    return _torchcrepe_punkte(
        f0[0].tolist(),
        periodicity[0].tolist(),
        hop / rate,
        p["periodicity_medianfenster"],
        p["stimmhaft_ab"],
    )


def track_pitch(
    vocals: Path, work_dir: Path, audio_hash: str, device: str = "cpu"
) -> list[PitchPoint]:
    """f0-Verlauf der Gesangsspur, in MIDI-Halbtoenen."""
    if modellwahl.PITCH not in (SWIFTF0, TORCHCREPE):
        # Ein Tippfehler in USC_PITCH darf nicht still SwiftF0 rechnen und
        # das Ergebnis unter dem falschen Namen cachen.
        raise ValueError(
            f"Unbekanntes Tonhoehenmodell {modellwahl.PITCH!r}; "
            f"bekannt: {SWIFTF0!r}, {TORCHCREPE!r}"
        )

    ziel = stage_path(
        work_dir, audio_hash, "pitch", _cache_parameter(), STAGE_VERSION, ".json"
    )
    if ziel.is_file():
        emit_progress("pitch", 1.0)
        return [PitchPoint(**p) for p in json.loads(ziel.read_text(encoding="utf8"))]

    emit_progress("pitch", 0.0)

    if modellwahl.PITCH == TORCHCREPE:
        punkte = _verlauf_torchcrepe(vocals, device)
    else:
        punkte = _verlauf_swiftf0(vocals)

    atomic_write_bytes(ziel, json.dumps([p.__dict__ for p in punkte]).encode("utf8"))
    emit_progress("pitch", 1.0)
    return punkte
