"""Recover missing pitch only with independent, temporally local evidence."""

from bisect import bisect_left
from dataclasses import replace
import math

from .notes import PitchPoint

PARAMETERS = {
    "min_primary_confidence": 0.5,
    "max_difference_semitones": 0.5,
    "max_time_distance_seconds": 0.006,
    "min_consecutive_frames": 3,
    "max_frame_gap_seconds": 0.020,
}


def merge_pitch(primary: list[PitchPoint], secondary: list[PitchPoint]) -> list[PitchPoint]:
    """Keep trusted primary frames; no interpolation or octave folding is allowed."""
    times = [p.time for p in secondary]
    candidates: list[PitchPoint | None] = []
    for point in primary:
        candidate = None
        if (not point.voiced and point.confidence is not None
                and math.isfinite(point.midi) and point.midi > 0
                and PARAMETERS["min_primary_confidence"] <= point.confidence <= 1):
            pos = bisect_left(times, point.time)
            neighbours = secondary[max(0, pos - 1):pos + 1]
            other = min(neighbours, key=lambda p: abs(p.time - point.time)) if neighbours else None
            if (other is not None and other.voiced and other.confidence is not None
                    and math.isfinite(other.midi) and other.midi > 0
                    and 0 <= other.confidence <= 1
                    and abs(other.time - point.time) <= PARAMETERS["max_time_distance_seconds"]
                    and abs(other.midi - point.midi) <= PARAMETERS["max_difference_semitones"]):
                candidate = replace(point, voiced=True, source="consensus",
                                    confidence=min(point.confidence, other.confidence))
        candidates.append(candidate)
    result = list(primary)
    start = 0
    while start < len(candidates):
        if candidates[start] is None:
            start += 1
            continue
        end = start + 1
        while (end < len(candidates) and candidates[end] is not None
               and 0 < primary[end].time - primary[end - 1].time <= PARAMETERS["max_frame_gap_seconds"]):
            end += 1
        if end - start >= PARAMETERS["min_consecutive_frames"]:
            result[start:end] = candidates[start:end]
        start = end
    return result
