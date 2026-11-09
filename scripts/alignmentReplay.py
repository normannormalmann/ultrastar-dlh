"""Replay only alignment against a modelRegression run's frozen inputs.

Set PYTHONPATH to python-sidecar and use the existing model interpreter.
No separation, transcription, pitch inference or original library writes occur.
"""

import argparse
import hashlib
import json
import platform
from collections import Counter
from pathlib import Path

from ultrastar_pipeline.align import align, STAGE_VERSION
from ultrastar_pipeline.anchors import berechne_anker
from ultrastar_pipeline.notes import PitchPoint, build_notes, export_bpm, NoteTimingError
from ultrastar_pipeline.transcribe import TranskriptWort


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path, help="One numbered modelRegression song directory")
    parser.add_argument("out_dir", type=Path, help="New directory; existing output is never overwritten")
    parser.add_argument("--device", choices=["cpu", "cuda"], required=True)
    parser.add_argument("--language", default="de")
    args = parser.parse_args()
    source, target = args.run_dir.resolve(), args.out_dir.resolve()
    if target == source or source in target.parents:
        parser.error("Output must be outside the frozen input directory")

    def stage_path(stage):
        matches = list((source / "cache").rglob(stage + "-*.json"))
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {stage} artifact, found {len(matches)}")
        return matches[0]

    paths = {stage: stage_path(stage) for stage in ("transcribe", "align", "pitch")}
    paths.update(lyrics=source / "lyrics.txt", vocals=source / "vocals.wav", song=source / "song_data.json")
    hashes = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items()}
    load = lambda key: json.loads(paths[key].read_text(encoding="utf8"))
    lines = paths["lyrics"].read_text(encoding="utf8").splitlines()
    anchors = berechne_anker([word for line in lines for word in line.split()],
                             [TranskriptWort(**word) for word in load("transcribe")])
    target.mkdir(parents=True, exist_ok=False)
    warnings = []
    words = align(paths["vocals"], lines, args.language, target / "cache", hashes["vocals"],
                  args.device, warnings, anchors)
    (target / "words.json").write_text(json.dumps([word.__dict__ for word in words], ensure_ascii=False), encoding="utf8")
    report = {
        "alignStageVersion": STAGE_VERSION, "device": args.device, "language": args.language,
        "platform": platform.platform(), "python": platform.python_version(),
        "inputHashes": hashes, "words": len(words),
        "beforeSources": dict(Counter(w["quelle"] for w in load("align")["words"])),
        "afterSources": dict(Counter(w.quelle for w in words)), "warnings": warnings,
        "musicalAcceptance": "not assessed; source counts are not timing accuracy",
    }
    try:
        data = load("song")
        bpm = data.get("meta", {}).get("musicalBpm", data["bpm"])
        notes, _, _, _ = build_notes(words, [PitchPoint(**p) for p in load("pitch")], export_bpm(bpm), args.language)
        report.update(export="passed", notes=len(notes), missingPitch=sum(n.pitch_status == "missing" for n in notes))
    except NoteTimingError as error:
        report.update(export="rejected", detail=str(error))
    (target / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf8")
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
