from dataclasses import replace
import pytest

from ultrastar_pipeline.notes import PitchPoint
from ultrastar_pipeline.pitchConsensus import merge_pitch


def points(midi=60, confidence=.7, voiced=False, count=4):
    return [PitchPoint(.008 + i*.016, midi, voiced, confidence, "swift-f0") for i in range(count)]


def test_only_independently_supported_runs_recover_missing_pitch():
    primary = points()
    secondary = [replace(p, time=p.time+.004, midi=60.3, voiced=True, confidence=.4) for p in primary]
    merged = merge_pitch(primary, secondary)
    assert all(p.voiced and p.source == "consensus" and p.confidence == .4 for p in merged)
    assert [p.time for p in merged] == [p.time for p in primary]
    assert all(not p.voiced for p in primary)


@pytest.mark.parametrize("change", [
    {"midi": 72}, {"midi": 60.51}, {"midi": float("nan")},
    {"voiced": False}, {"confidence": None}, {"confidence": float("nan")},
])
def test_disagreement_and_absent_evidence_never_fill_holes(change):
    primary = points()
    secondary = [replace(p, voiced=True, **change) if "voiced" not in change else replace(p, **change) for p in primary]
    assert merge_pitch(primary, secondary) == primary


def test_neighbouring_audio_is_not_borrowed():
    primary = points(count=3)
    secondary = [replace(p, time=p.time+1, voiced=True) for p in primary]
    assert merge_pitch(primary, secondary) == primary


def test_single_frames_and_gaps_cannot_form_a_supported_run():
    primary = points(count=2)
    assert merge_pitch(primary, [replace(p, voiced=True) for p in primary]) == primary
    primary = [replace(p,time=i) for i,p in enumerate(points())]
    assert merge_pitch(primary, [replace(p, voiced=True) for p in primary]) == primary


def test_existing_measurements_are_preserved_even_when_models_disagree():
    primary = points(voiced=True)
    assert merge_pitch(primary, points(midi=72, voiced=True)) == primary


def test_low_primary_confidence_and_empty_secondary_do_not_recover():
    primary = points(confidence=.49)
    assert merge_pitch(primary, points(voiced=True)) == primary
    assert merge_pitch(points(), []) == points()
