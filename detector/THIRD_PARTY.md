# Model provenance

This service adapts [DroidDetect](https://aclanthology.org/2025.emnlp-main.1593/),
by Daniil Orel, Indraneil Paul, Iryna Gurevych and Preslav Nakov, for CodeEval inference.
It uses **Base Binary** by default, or **Large Binary** when `ai_detection.model: large`.
Both perform two-class detection. Models are downloaded on the deployment host
and are not committed to this repository.

| Artifact | Source | Pinned revision |
| --- | --- | --- |
| Encoder architecture config only | [answerdotai/ModernBERT-base](https://huggingface.co/answerdotai/ModernBERT-base) | `8949b909ec900327062f0ebf497f51aef5e6f0c8` |
| Full fine-tuned encoder, binary head, tokenizer, model card | [project-droid/DroidDetect-Base-Binary](https://huggingface.co/project-droid/DroidDetect-Base-Binary) | `4328ba9443dd870cf7b645571ab9a96e5eed4c2a` |
| Large encoder architecture config only | [answerdotai/ModernBERT-large](https://huggingface.co/answerdotai/ModernBERT-large) | `45bb4654a4d5aaff24dd11d4781fa46d39bf8c13` |
| Large fine-tuned encoder, binary head, tokenizer, model card | [project-droid/DroidDetect-Large-Binary](https://huggingface.co/project-droid/DroidDetect-Large-Binary) | `44c45cbfb2dbf307e66acc691440f0cab3a0ddf5` |

Both upstream model repositories declare Apache-2.0. The checkpoint model card is
retained with the artifacts. Applicable upstream terms govern those artifacts.
The pretrained encoder weights are not separately downloaded: the classifier state
dictionary already contains the full fine-tuned encoder.

## Verified checkpoint differences

The pinned Base checkpoint's `text_projection` is **768 -> 256**; Large is
**1024 -> 256** (verified from the pinned checkpoint's tensor metadata). Both
binary heads are **256 -> 2**, despite the model cards and custom configs describing
128 projection dimensions. CodeEval infers the projection width from the actual
state dictionary and checks it against the selected encoder and binary head.
The state dictionary also contains `additional_loss.sentence_embedder.*` aliases
of `text_encoder.*`. These are represented by a shared module, checked for tensor
equality, and loaded with strict key/shape validation using `weights_only=True`.
No training loss dependency or remote model code is executed.

Inference uses mean pooling over each unpadded window, ReLU projection, and
**softmax(logits)[1]**: class 0 is HUMAN_GENERATED, class 1 is MACHINE_GENERATED.
This is not the former LLMSniffer sigmoid/reversed-score convention.
The raw source, comments, docstrings, blank lines and original offsets are retained.
One shared model handles Python, Java, C++ and Go; language aliases are normalized.

## CodeEval adaptations and limits

CodeEval uses at most 512 tokens including special tokens per window, a 64 content
token overlap, and a weighted average based on newly covered tokens. The window
limit stays conservative even though the base encoder supports longer inputs.
Over-limit inputs fail explicitly instead of silently truncating. Runtime stays
float32, one request and window at a time, with SDPA attention and no optional
FlashAttention or torch.compile dependency. All inference artifacts load offline.

Reports identify `droiddetect-binary-chunks-v1`, `raw-source-v1`, both pinned
revisions, model size/repository, actual device/name and precision. Base keeps the
existing `/models/` cache; Large uses `/models/large/` in the same named volume.
Historical LLMSniffer reports remain
readable and are not rewritten. Old model cache files are not used by this loader.
Base real-checkpoint CPU smoke tests and tiny-checkpoint tests for both loader
paths verify loading, finite scores and complete source coverage; they
are not accuracy benchmarks. Course-specific detection quality, long-code
aggregation, short programs, Chinese comments and modern unseen generators still
require independent labeled evaluation. A score is not a calibrated probability,
AI-written line fraction, or evidence of authorship for individual lines.
