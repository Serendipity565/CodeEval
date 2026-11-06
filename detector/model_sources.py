"""Pinned public artifacts; no student code is sent to these repositories."""

ENCODER_REPO = "answerdotai/ModernBERT-base"
ENCODER_REVISION = "8949b909ec900327062f0ebf497f51aef5e6f0c8"
CHECKPOINT_REPO = "project-droid/DroidDetect-Base-Binary"
CHECKPOINT_REVISION = "4328ba9443dd870cf7b645571ab9a96e5eed4c2a"
CHECKPOINT_FILES = ("config.json", "pytorch_model.bin", "tokenizer.json",
                    "tokenizer_config.json", "special_tokens_map.json", "README.md")
SUPPORTED_LANGUAGES = ("python", "java", "cpp", "go")
VERSION = "droiddetect-binary-chunks-v1"
PREPROCESSING_VERSION = "raw-source-v1"


def normalize_language(language):
    language = language.strip().lower()
    return "cpp" if language in ("c++", "cxx") else language
