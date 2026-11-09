"""Build a local listening/spectrum review pack from a fixed JSON clip manifest.

Manifest: {"clips": [{"id": "solo_a", "start": 2, "end": 6,
"audio": "input.wav", "vocals": "vocals.wav",
"traces": [{"label": "Baseline", "path": "pitch.json"}]}]}.
Paths are relative to the manifest. Review status is never inferred from models.
Requires the model environment plus matplotlib; does not modify source files.
"""
import argparse
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('out_dir', type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf8'))
    base = args.manifest.resolve().parent
    out = args.out_dir.resolve()
    ids = [clip['id'] for clip in manifest['clips']]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r'[a-zA-Z0-9_]+', name) for name in ids):
        parser.error('Clip IDs must be unique, using only letters, numbers and underscores')
    out.mkdir(parents=True, exist_ok=False)
    os.environ.setdefault('MPLCONFIGDIR', str(out/'.plot-cache'))
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from ultrastar_pipeline.modelBackend import load_audio, SAMPLE_RATE

    audio_cache = {}
    reviews, cards = [], []
    for clip in manifest['clips']:
        name = clip['id']
        start, end = float(clip['start']), float(clip['end'])
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end and end-start <= 30):
            raise ValueError('Review clips must be finite, positive and at most 30 seconds')
        row = dict(id=name, start=start, end=end, reviewStatus='pending_listening_review',
                   referenceNotes=[], inputHashes={})
        for kind in ('audio','vocals'):
            path = (base/clip[kind]).resolve()
            if path not in audio_cache:
                audio_cache[path] = load_audio(str(path))
            audio = audio_cache[path]
            if end > len(audio)/SAMPLE_RATE:
                raise ValueError(f'{name}: clip exceeds {kind} duration')
            samples = audio[round(start*SAMPLE_RATE):round(end*SAMPLE_RATE)]
            row['inputHashes'][kind] = hashlib.sha256(path.read_bytes()).hexdigest()
            with wave.open(str(out/f'{name}_{kind}.wav'), 'wb') as target:
                target.setnchannels(1)
                target.setsampwidth(2)
                target.setframerate(SAMPLE_RATE)
                target.writeframes((samples*32768).astype('<i2').tobytes())
            if kind == 'vocals':
                vocals = samples
        fig, axes = plt.subplots(2, 1, figsize=(12,7), sharex=True)
        axes[0].specgram(vocals, NFFT=2048, Fs=SAMPLE_RATE, noverlap=1792,
                        xextent=(start,end), cmap='magma', vmin=-100, vmax=-35)
        axes[0].set_ylim(60,1400)
        axes[0].set_ylabel('Spektrum (Hz)')
        axes[0].set_title(f'{name}: {start:g}–{end:g} s · Hörprüfung offen')
        for trace in clip['traces']:
            path = (base/trace['path']).resolve()
            points = json.loads(path.read_text(encoding='utf8'))
            selected = [p for p in points if p['voiced'] and start <= p['time'] < end]
            axes[1].scatter([p['time'] for p in selected], [440*2**((p['midi']-69)/12) for p in selected],
                            s=9, label=trace['label'])
            row['inputHashes'][trace['label']] = hashlib.sha256(path.read_bytes()).hexdigest()
        axes[1].set_ylim(60,1100)
        axes[1].set_xlim(start,end)
        axes[1].set_ylabel('Gemessene Grundfrequenz (Hz)')
        axes[1].set_xlabel('Zeit im Originalaudio (s)')
        axes[1].legend(loc='upper right')
        axes[1].grid(alpha=.2)
        fig.tight_layout()
        fig.savefig(out/f'{name}.png', dpi=120)
        plt.close(fig)
        reviews.append(row)
        cards.append(f'<section><h2>{html.escape(name)} · {start:g}–{end:g} s</h2>'
                     f'<p>Original <audio controls preload="none" src="{name}_audio.wav"></audio> '
                     f'Gesangsspur <audio controls preload="none" src="{name}_vocals.wav"></audio></p>'
                     f'<img src="{name}.png" alt="Spektrum und Tonhöhenvergleich"></section>')
    (out/'references.json').write_text(json.dumps({'clips':reviews}, ensure_ascii=False, indent=2),encoding='utf8')
    (out/'index.html').write_text('<!doctype html><html lang="de"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tonhöhenprüfung</title>'
        '<style>body{font:17px system-ui;margin:2rem auto;max-width:1100px;padding:0 1rem;background:#fafafa}'
        'section{border-top:1px solid #ccc;margin-top:2rem}img{width:100%}audio{vertical-align:middle;max-width:100%}</style>'
        '<h1>Tonhöhenprüfung</h1><p>Sechs Prüfschritte je Ausschnitt: Audiofassung, Wortbeginn, Hauptstimme, '
        'Tonhöhe, Oktave und Stille. Modellkurven sind Vorschläge, keine bestätigten Referenzen. '
        'Mehrstimmige oder unklare Stellen getrennt kennzeichnen.</p>'
        '<p>Die Zeitachse im Bild gehört zum Originalaudio; die Ausschnitt-Player beginnen bei null. '
        '<a href="references.json">Referenzprotokoll (Hörprüfung offen)</a></p>'
        + ''.join(cards) + '</html>', encoding='utf8')
    print(out/'index.html')


if __name__ == '__main__':
    main()
