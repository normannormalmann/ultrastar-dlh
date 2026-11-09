import math
import random

import pytest

from ultrastar_pipeline.alignmentTiming import select_anchors, validate_window
from ultrastar_pipeline.anchors import GemessenesWort
from ultrastar_pipeline.align import interpoliere


def anchor(start, end, score=0.8):
    return GemessenesWort(start, end, score, "anchor")


def test_surrounding_context_outweighs_one_conflicting_high_score_anchor():
    anchors = [anchor(0, 1), anchor(0.5, 8, 1), anchor(2, 3), anchor(4, 5)]
    selected = select_anchors(anchors, [1] * 4, 6)
    assert selected == [anchors[0], None, anchors[2], anchors[3]]
    assert anchors[1] is not None  # Caller-owned evidence is unchanged.


def test_missing_prefix_and_suffix_need_space_before_accepting_an_anchor():
    anchors = [None, None, anchor(0, 0.3), None, anchor(0.5, 1), None]
    assert select_anchors(anchors, [1] * 6, 1) == [None] * 6


def test_short_internal_gap_reopens_a_boundary_instead_of_overlapping_it():
    anchors = [anchor(1, 2), None, None, anchor(2.01, 3)]
    selected = select_anchors(anchors, [1] * 4, 5)
    assert sum(a is not None for a in selected) == 1
    result = interpoliere(anchors, ["start", "und", "melodie", "ende"], "de", 5)
    assert all(a.ende <= b.start for a, b in zip(result, result[1:]))


@pytest.mark.parametrize("bad", [
    anchor(-1, 0), anchor(1, 1), anchor(2, 1), anchor(1, math.inf),
    anchor(math.nan, 1), anchor(1, 2, math.nan), anchor(1, 2, 1.1), anchor(1, 20),
])
def test_invalid_anchors_are_removed(bad):
    assert select_anchors([bad], [1], 5) == [None]


def test_collapsed_prefix_is_realignment_candidate_with_positive_fallback_times():
    result = interpoliere([None, None, anchor(0, 0.2)], ["eins", "zwei", "drei"], "de", 3)
    assert all(w.quelle == "interpolated" and w.score == 0 for w in result)
    assert all(0 <= w.start < w.ende <= 3 for w in result)


def test_dense_prefix_scales_all_words_without_collapsing_them_at_zero():
    result = interpoliere([None, None, anchor(0.13, 0.4)], ["a", "b", "c"], "de", 3)
    assert result[-1].quelle == "anchor"
    assert all(0 <= w.start < w.ende for w in result)
    assert result[1].ende == pytest.approx(0.13)


@pytest.mark.parametrize("word", [
    {"start": 1, "end": 1}, {"start": 1.5, "end": 1},
    {"start": math.nan, "end": 1.5}, {"start": 1, "end": math.inf},
    {"start": 1, "end": 1.5, "score": math.nan},
    {"start": 1, "end": 1.5, "score": 1.1},
    {"start": None, "end": 1.5}, {"start": "bad", "end": 1.5},
    {"start": 0.999, "end": 1.5}, {"start": 1, "end": 2.001},
])
def test_ctc_never_repairs_invalid_measurements(word):
    assert validate_window([word], 1, 2) is None


def test_monotonic_starts_are_insufficient_when_words_overlap():
    assert validate_window([{"start": 1, "end": 2}, {"start": 1.5, "end": 3}], 0, 4) is None


def test_random_conflicting_anchors_leave_bounded_ordered_fallbacks():
    rng = random.Random(421)
    for _ in range(100):
        anchors = [anchor(rng.uniform(-1, 5), rng.uniform(0, 6)) if rng.random() < .7 else None
                   for _ in range(20)]
        result = interpoliere(anchors, ["melodie"] * 20, "de", 5)
        assert len(result) == 20
        assert all(0 <= w.start < w.ende <= 5 for w in result)
        assert all(a.ende <= b.start for a, b in zip(result, result[1:]))
