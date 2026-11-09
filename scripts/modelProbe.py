"""Run real models and record process-tree memory independently of song quality."""
import importlib.metadata
import json
import sys
import threading
import time
from pathlib import Path

import psutil


def main():
    report_path = Path(sys.argv[1])
    arguments = sys.argv[2:]
    done = threading.Event()
    peak = 0
    process = psutil.Process()

    def sample():
        nonlocal peak
        while not done.is_set():
            try:
                total = process.memory_info().rss
                for child in process.children(recursive=True):
                    try:
                        total += child.memory_info().rss
                    except psutil.Error:
                        pass
                peak = max(peak, total)
            except psutil.Error:
                pass
            done.wait(0.1)

    thread = threading.Thread(target=sample, daemon=True)
    thread.start()
    started = time.monotonic()
    code = 1
    try:
        from ultrastar_pipeline.__main__ import main as pipeline
        code = pipeline(arguments)
        return code
    finally:
        done.set()
        thread.join()
        report = {"exitCode": code, "seconds": time.monotonic() - started, "peakRssBytes": peak,
                  "packages": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}}
        torch = sys.modules.get("torch")
        report["peakCudaBytes"] = torch.cuda.max_memory_allocated() if torch and torch.cuda.is_initialized() else 0
        report_path.write_text(json.dumps(report, indent=2), encoding="utf8")


if __name__ == "__main__":
    sys.exit(main())
