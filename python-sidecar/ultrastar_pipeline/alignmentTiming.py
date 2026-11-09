"""Model-free timing constraints shared by anchor selection and CTC validation."""

import math


def valid_interval(start: float, end: float, lower: float, upper: float) -> bool:
    return (all(math.isfinite(v) for v in (start, end, lower, upper))
            and lower <= start < end <= upper)


def select_anchors(anchors, weights: list[int], duration: float):
    """Keep the highest-weight feasible chain without moving measured timestamps.

    Reserve 60 ms per estimated syllable for missing text. This permissive floor
    detects impossible placement, not musical correctness. Dynamic programming
    lets surrounding anchors outweigh a single long or misplaced measurement.
    """
    minimum = 0.06
    prefix = [0.0]
    for weight in weights:
        prefix.append(prefix[-1] + minimum * weight)
    candidates = [
        (i, a) for i, a in enumerate(anchors)
        if a is not None
        and valid_interval(a.start, a.ende, 0.0, duration)
        and math.isfinite(a.score) and 0 <= a.score <= 1
        and a.start + 1e-9 >= prefix[i]
        and duration - a.ende + 1e-9 >= prefix[-1] - prefix[i + 1]
    ]
    scores, previous = [], []
    for k, (i, anchor) in enumerate(candidates):
        best, parent = 0.0, -1
        for j, (before_i, before) in enumerate(candidates[:k]):
            needed = prefix[i] - prefix[before_i + 1]
            gap = anchor.start - before.ende
            if gap >= 0 and gap + 1e-9 >= needed and scores[j] > best:
                best, parent = scores[j], j
        # Confidence is a tie-breaker; repeated contextual support matters more.
        weight = (0.5 if anchor.quelle == "fuzzy" else 1.0) + anchor.score * 0.25
        scores.append(best + weight)
        previous.append(parent)
    result = [None] * len(anchors)
    k = max(range(len(scores)), key=scores.__getitem__) if scores else -1
    while k >= 0:
        i, anchor = candidates[k]
        result[i] = anchor
        k = previous[k]
    return result


def validate_window(words: list[dict], start: float, end: float):
    """Require finite, positive, non-overlapping measurements inside the window."""
    result = []
    previous_end = start
    for word in words:
        try:
            ws, we = float(word["start"]), float(word["end"])
            score = float(word.get("score", 0.0))
        except (KeyError, TypeError, ValueError):
            return None
        if (not valid_interval(ws, we, start, end) or ws < previous_end
                or not math.isfinite(score) or not 0 <= score <= 1):
            return None
        result.append((ws, we, score))
        previous_end = we
    return result
