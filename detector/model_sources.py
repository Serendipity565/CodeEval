"""Pinned public artifacts; no student code is sent to these repositories."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSource:
    size: str
    encoder_repo: str
    encoder_revision: str
    checkpoint_repo: str
    checkpoint_revision: str
    hidden_size: int

    def directory(self, root):
        # Preserve the original Base cache; Large has an independent manifest.
        return root if self.size == "base" else root / self.size

    def manifest(self):
        return {
            "encoder": {"repo": self.encoder_repo, "revision": self.encoder_revision},
            "checkpoint": {"repo": self.checkpoint_repo, "revision": self.checkpoint_revision},
        }


MODEL_SOURCES = {
    "base": ModelSource("base", "answerdotai/ModernBERT-base",
                        "8949b909ec900327062f0ebf497f51aef5e6f0c8",
                        "project-droid/DroidDetect-Base-Binary",
                        "4328ba9443dd870cf7b645571ab9a96e5eed4c2a", 768),
    "large": ModelSource("large", "answerdotai/ModernBERT-large",
                         "45bb4654a4d5aaff24dd11d4781fa46d39bf8c13",
                         "project-droid/DroidDetect-Large-Binary",
                         "44c45cbfb2dbf307e66acc691440f0cab3a0ddf5", 1024),
}


def model_source(size):
    try:
        return MODEL_SOURCES[size]
    except KeyError:
        raise RuntimeError("ai_detection.model must be base or large") from None


# Backwards-compatible names used by existing Base checkpoint checks.
ENCODER_REPO = MODEL_SOURCES["base"].encoder_repo
ENCODER_REVISION = MODEL_SOURCES["base"].encoder_revision
CHECKPOINT_REPO = MODEL_SOURCES["base"].checkpoint_repo
CHECKPOINT_REVISION = MODEL_SOURCES["base"].checkpoint_revision
CHECKPOINT_FILES = ("config.json", "pytorch_model.bin", "tokenizer.json",
                    "tokenizer_config.json", "special_tokens_map.json", "README.md")
SUPPORTED_LANGUAGES = ("python", "java", "cpp", "go")
VERSION = "droiddetect-binary-chunks-v1"
PREPROCESSING_VERSION = "raw-source-v1"


def normalize_language(language):
    language = language.strip().lower()
    return "cpp" if language in ("c++", "cxx") else language
