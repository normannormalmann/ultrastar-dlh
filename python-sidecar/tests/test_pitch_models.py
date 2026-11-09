"""Exact generated references; these do not replace a singing listening review."""
import math
import wave

import pytest


@pytest.mark.slow
@pytest.mark.parametrize('device', ['cpu', 'cuda'])
def test_real_pitch_models_preserve_known_tones_and_reject_silence(tmp_path, monkeypatch, device):
    import numpy as np
    import torch
    from ultrastar_pipeline import modellwahl, pitch
    if device == 'cuda' and not torch.cuda.is_available():
        pytest.skip('CUDA unavailable')
    rate = 22050  # Exercise the shared decoder's resampling and time base.
    expected = [0, 110, 220, 440, 880, 0]
    t = np.arange(rate) / rate
    signal = np.concatenate([
        .1 * (np.sin(2*np.pi*hz*t) + .5*np.sin(4*np.pi*hz*t)) if hz else np.zeros(rate)
        for hz in expected
    ])
    path = tmp_path/'tones.wav'
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes((signal*32767).astype('<i2').tobytes())
    monkeypatch.setattr(modellwahl, 'PITCH', pitch.CONSENSUS)
    secondary_runs = []
    original = pitch._verlauf_torchcrepe
    def measure_secondary(*args):
        result = original(*args)
        secondary_runs.append(result)
        return result
    monkeypatch.setattr(pitch, '_verlauf_torchcrepe', measure_secondary)
    state = np.random.get_state()
    points = pitch.track_pitch(path, tmp_path/'work', 'tones', device)
    after = np.random.get_state()
    assert state[0] == after[0] and np.array_equal(state[1], after[1]) and state[2:] == after[2:]
    # Check CREPE itself too: the merge retains already trusted primary tones.
    for trace in [points, secondary_runs[0]]:
        for i, hz in enumerate(expected):
            frames = [p for p in trace if i+.15 <= p.time < i+.85]
            accepted = [p for p in frames if p.voiced]
            if hz:
                assert len(accepted) / len(frames) >= .9
                errors = [abs((p.midi-(69+12*math.log2(hz/440)))*100) for p in accepted]
                assert max(errors) < 50
            else:
                assert not accepted
    assert 5.98 < points[-1].time < 6.02
    # Fresh inference, not a cache hit, must reproduce the decoded pitch.
    repeated = pitch.track_pitch(path, tmp_path/'repeat', 'tones', device)
    assert repeated == points
