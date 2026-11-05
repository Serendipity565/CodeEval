"""Run once in the model-init container, then retain /models as a named volume."""

import json

from huggingface_hub import snapshot_download

from model_sources import (
    CHECKPOINT_FILES, CHECKPOINT_REPO, CHECKPOINT_REVISION,
    ENCODER_REPO, ENCODER_REVISION,
)
from settings import load_settings


def download(settings=None):
    settings = settings or load_settings()
    if not settings.local_enabled:
        print("DeepSeek detection selected; local model download skipped.", flush=True)
        return
    root = settings.model_dir
    expected = {
        "encoder": {"repo": ENCODER_REPO, "revision": ENCODER_REVISION},
        "checkpoint": {"repo": CHECKPOINT_REPO, "revision": CHECKPOINT_REVISION},
    }
    # The fine-tuned state dictionary already contains the complete encoder.
    required = [root / "encoder" / "config.json"] + [root / "droiddetect" / name for name in CHECKPOINT_FILES]
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        try:
            if json.loads(manifest_path.read_text()) == expected and all(p.is_file() and p.stat().st_size > 0 for p in required):
                print("Pinned model volume is complete; no network download needed.", flush=True)
                return
        except (OSError, ValueError):
            pass
    snapshot_download(
        ENCODER_REPO, revision=ENCODER_REVISION, local_dir=root / "encoder",
        allow_patterns=["config.json"],
    )
    snapshot_download(
        CHECKPOINT_REPO, revision=CHECKPOINT_REVISION, local_dir=root / "droiddetect",
        allow_patterns=list(CHECKPOINT_FILES),
    )
    if not all(p.is_file() and p.stat().st_size > 0 for p in required):
        raise RuntimeError("DroidDetect download is incomplete; no manifest was written.")
    manifest_path.write_text(json.dumps(expected, indent=2) + "\n")
    print("Pinned DroidDetect binary detector artifacts are ready.", flush=True)


if __name__ == "__main__":
    download()
