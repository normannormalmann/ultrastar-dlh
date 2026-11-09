"""Compare pitch backends on frozen audio and word timing, without separation or ASR."""
import argparse
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform
import time

from ultrastar_pipeline import modellwahl, pitch
from ultrastar_pipeline.notes import AlignedWord, build_notes, export_bpm


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_dir', type=Path)
    parser.add_argument('words', type=Path, help='Frozen aligned words JSON from alignmentReplay')
    parser.add_argument('out_dir', type=Path, help='New output directory')
    parser.add_argument('--backend', choices=[pitch.SWIFTF0, pitch.TORCHCREPE, pitch.CONSENSUS], required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], required=True)
    parser.add_argument('--language', default='de')
    args = parser.parse_args()
    root, out = args.run_dir.resolve(), args.out_dir.resolve()
    if root == out or root in out.parents:
        parser.error('Output must be outside the frozen input directory')
    inputs = {'vocals': root/'vocals.wav', 'song': root/'song_data.json', 'words': args.words}
    hashes = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key,path in inputs.items()}
    words = [AlignedWord(**w) for w in json.loads(args.words.read_text(encoding='utf8'))]
    data = json.loads(inputs['song'].read_text(encoding='utf8'))
    out.mkdir(parents=True, exist_ok=False)
    modellwahl.PITCH = args.backend
    started = time.perf_counter()
    points = pitch.track_pitch(inputs['vocals'], out/'cache', hashes['vocals'], args.device)
    notes, *_ = build_notes(words, points, export_bpm(data.get('meta',{}).get('musicalBpm',data['bpm'])), args.language)
    packages = ['swift-f0'] if args.backend == pitch.SWIFTF0 else ['swift-f0','torchcrepe','torch']
    report = {
        'backend': args.backend, 'pitchStageVersion': pitch.STAGE_VERSION,
        'parameters': pitch._cache_parameter(), 'device': args.device, 'platform': platform.platform(),
        'packages': {name:version(name) for name in packages}, 'inputHashes': hashes,
        'seconds': round(time.perf_counter()-started, 3), 'frames': len(points),
        'voicedFrames': sum(p.voiced for p in points),
        'recoveredFrames': sum(p.source == 'consensus' for p in points),
        'notes': len(notes), 'missingNotes': sum(n.pitch_status == 'missing' for n in notes),
        'musicalAcceptance': 'not assessed; coverage is not accuracy',
    }
    for name, payload in [('pitch.json',[p.__dict__ for p in points]), ('report.json',report)]:
        (out/name).write_text(json.dumps(payload, ensure_ascii=False, indent=2),encoding='utf8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
