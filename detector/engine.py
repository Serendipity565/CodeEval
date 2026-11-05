"""Local classifier implementation, imported only when YAML selects it."""

from bisect import bisect_right
import json
import logging
import math
import threading

from fastapi import HTTPException
import torch
from torch import nn
from transformers import AutoConfig, AutoModel, AutoTokenizer

from model_sources import CHECKPOINT_REVISION, ENCODER_REVISION, PREPROCESSING_VERSION, VERSION
from preprocessing import preprocess
from runtime import select_device

OVERLAP = 64
TOKEN_LIMIT = 512


class Classifier(nn.Module):
    """Architecture verified against the pinned state dictionary.

    Its projection is 256-wide despite the model card/config saying 128.
    The training loss serialized an alias of the same encoder. Retain that
    namespace for strict loading without importing the training loss library.
    """
    def __init__(self, encoder):
        super().__init__()
        self.text_encoder = encoder
        self.additional_loss = nn.Module()
        self.additional_loss.sentence_embedder = encoder
        self.text_projection = nn.Linear(encoder.config.hidden_size, 256)
        self.classifier = nn.Linear(256, 2)

    def forward(self, input_ids, attention_mask):
        # One unpadded window per call, matching the model card's mean pooling.
        hidden = self.text_encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state.mean(dim=1)
        return self.classifier(torch.relu(self.text_projection(hidden)))


class Engine:
    def __init__(self, settings):
        self.root = settings.model_dir
        self.max_chunks = settings.max_chunks
        self.device = torch.device(select_device(settings.device, torch.cuda.is_available()))
        self.device_name = torch.cuda.get_device_name(self.device) if self.device.type == "cuda" else "CPU"
        self.precision = "float32"
        logging.getLogger("uvicorn.error").info(
            "Classifier device=%s name=%s precision=%s; one request and one chunk at a time",
            self.device, self.device_name, self.precision,
        )
        manifest = json.loads((self.root / "manifest.json").read_text())
        if (manifest["encoder"]["revision"] != ENCODER_REVISION
                or manifest["checkpoint"]["revision"] != CHECKPOINT_REVISION):
            raise RuntimeError("Model volume revision differs; rerun model-init.")
        torch.set_num_threads(settings.cpu_threads)
        self.tokenizer = AutoTokenizer.from_pretrained(self.root / "droiddetect", local_files_only=True, use_fast=True)
        # This checkpoint uses generic PreTrainedTokenizerFast: its backend
        # adds CLS/SEP, but prepare_for_model silently omits both. Verify the
        # pinned template once and explicitly wrap token windows below.
        self.cls_id, self.sep_id = self.tokenizer.cls_token_id, self.tokenizer.sep_token_id
        probe = self.tokenizer("x", add_special_tokens=False)["input_ids"]
        if (self.cls_id is None or self.sep_id is None
                or self.tokenizer.num_special_tokens_to_add(pair=False) != 2
                or self.tokenizer("x")["input_ids"] != [self.cls_id, *probe, self.sep_id]):
            raise RuntimeError("Unexpected DroidDetect tokenizer special-token template")
        checkpoint_config = json.loads((self.root / "droiddetect" / "config.json").read_text())
        if checkpoint_config.get("num_classes") != 2:
            raise RuntimeError("Expected the pinned DroidDetect Base Binary checkpoint")
        config = AutoConfig.from_pretrained(self.root / "encoder", local_files_only=True)
        # SDPA works on CPU/CUDA without optional FlashAttention or torch.compile.
        config.reference_compile = False
        encoder = AutoModel.from_config(config, attn_implementation="sdpa")
        self.model = Classifier(encoder)
        state = torch.load(self.root / "droiddetect" / "pytorch_model.bin", map_location="cpu", weights_only=True)
        for key, value in state.items():
            if key.startswith("text_encoder."):
                alias = "additional_loss.sentence_embedder." + key.removeprefix("text_encoder.")
                if alias not in state or not torch.equal(value, state[alias]):
                    raise RuntimeError("DroidDetect encoder aliases differ in checkpoint")
        self.model.load_state_dict(state, strict=True)
        self.model = self.model.to(device=self.device, dtype=torch.float32).eval()
        del state
        self.lock = threading.Lock()

    def detect(self, code, language):
        with self.lock:
            return self._detect(code, language)

    def _detect(self, code, language):
        cleaned = preprocess(code, language)
        if not cleaned.strip():
            return self._result(language, [], 0, None)
        encoded = self.tokenizer(cleaned, add_special_tokens=False, return_offsets_mapping=True, truncation=False)
        ids, offsets = encoded["input_ids"], encoded["offset_mapping"]
        if not ids:
            return self._result(language, [], 0, None)
        capacity = TOKEN_LIMIT - self.tokenizer.num_special_tokens_to_add(pair=False)
        step = capacity - OVERLAP
        count = 1 + max(0, math.ceil((len(ids) - capacity) / step))
        if count > self.max_chunks:
            raise HTTPException(413, detail=f"代码需分为 {count} 块，超过 {self.max_chunks} 块上限；未截断或生成分数")
        line_starts = [0] + [i + 1 for i, char in enumerate(code) if char == "\n"]
        chunks, covered = [], 0
        for start in range(0, len(ids), step):
            end = min(start + capacity, len(ids))
            input_ids = torch.tensor([[self.cls_id, *ids[start:end], self.sep_id]], device=self.device)
            prepared = {"input_ids": input_ids, "attention_mask": torch.ones_like(input_ids)}
            with torch.inference_mode():
                ai_score = torch.softmax(self.model(**prepared), dim=-1)[0, 1].item()
            if not math.isfinite(ai_score):
                raise RuntimeError("Classifier returned a non-finite score")
            valid = [(a, b) for a, b in offsets[start:end] if b > a]
            if not valid:
                raise RuntimeError("Tokenizer returned a chunk without source offsets")
            first = min(a for a, _ in valid)
            last = max(b for _, b in valid) - 1
            chunks.append({
                "index": len(chunks) + 1,
                "startLine": bisect_right(line_starts, first),
                "endLine": bisect_right(line_starts, last),
                "tokenCount": end - start, "weightTokens": end - covered,
                "aiScore": ai_score,
            })
            covered = end
            if end == len(ids):
                break
        score = sum(c["aiScore"] * c["weightTokens"] for c in chunks) / len(ids)
        return self._result(language, chunks, len(ids), score)

    def _result(self, language, chunks, total, score):
        return {
            "version": VERSION, "language": language, "aiScore": score,
            "chunks": chunks, "totalTokens": total, "coveredTokens": total,
            "truncated": False, "maxSequenceTokens": TOKEN_LIMIT,
            "overlapTokens": OVERLAP, "encoderRevision": ENCODER_REVISION,
            "checkpointRevision": CHECKPOINT_REVISION,
            "preprocessingVersion": PREPROCESSING_VERSION,
            "device": str(self.device), "deviceName": self.device_name,
            "precision": self.precision,
        }

    def runtime_info(self):
        result = {
            "device": str(self.device), "deviceName": self.device_name,
            "precision": self.precision, "cudaRuntime": torch.version.cuda,
        }
        if self.device.type == "cuda":
            result["gpuMemoryTotalMiB"] = torch.cuda.get_device_properties(self.device).total_memory // (1024 * 1024)
        return result


