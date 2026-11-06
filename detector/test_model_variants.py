"""Both loader paths with tiny local checkpoints; no download or GPU required."""

from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import torch
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
from tokenizers.processors import TemplateProcessing
from transformers import AutoModel, ModernBertConfig, PreTrainedTokenizerFast

from engine import Classifier, Engine
from model_sources import model_source
from settings import Settings


class VariantTests(unittest.TestCase):
    def checkpoint(self, size, root):
        source = replace(model_source(size), hidden_size=16)
        directory = source.directory(root)
        encoder_dir, checkpoint_dir = directory / "encoder", directory / "droiddetect"
        encoder_dir.mkdir(parents=True)
        checkpoint_dir.mkdir()
        config = ModernBertConfig(vocab_size=8, hidden_size=16, intermediate_size=32,
                                  num_hidden_layers=1, num_attention_heads=4,
                                  pad_token_id=0, cls_token_id=1, sep_token_id=2,
                                  reference_compile=False)
        config.save_pretrained(encoder_dir)
        model = Classifier(AutoModel.from_config(config, attn_implementation="sdpa"), projection_dim=7)
        torch.save(model.state_dict(), checkpoint_dir / "pytorch_model.bin")
        (checkpoint_dir / "config.json").write_text('{"num_classes":2,"projection_dim":128}')
        tokenizer = Tokenizer(WordLevel({"[PAD]": 0, "[CLS]": 1, "[SEP]": 2, "[UNK]": 3, "x": 4}, unk_token="[UNK]"))
        tokenizer.pre_tokenizer = Whitespace()
        tokenizer.post_processor = TemplateProcessing(single="[CLS] $A [SEP]", special_tokens=[("[CLS]", 1), ("[SEP]", 2)])
        PreTrainedTokenizerFast(tokenizer_object=tokenizer, cls_token="[CLS]", sep_token="[SEP]",
                               pad_token="[PAD]", unk_token="[UNK]").save_pretrained(checkpoint_dir)
        (directory / "manifest.json").write_text(json.dumps(source.manifest()))
        return source

    def test_each_variant_loads_actual_head_shape_and_reports_selected_model(self):
        for size in ("base", "large"):
            with self.subTest(size=size), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = self.checkpoint(size, root)
                with patch("engine.model_source", return_value=source):
                    engine = Engine(Settings("auto", "test", 1, 100000, device="cpu", model=size, model_dir=root))
                self.assertEqual(tuple(engine.model.text_projection.weight.shape), (7, 16))
                result = engine.detect("x " * 600, "python")
                self.assertEqual(result["modelSize"], size)
                self.assertEqual(result["modelRepository"], source.checkpoint_repo)
                self.assertEqual(result["checkpointRevision"], source.checkpoint_revision)
                self.assertEqual(result["totalTokens"], 600)
                self.assertEqual(sum(c["weightTokens"] for c in result["chunks"]), 600)
                self.assertEqual(len(result["chunks"]), 2)
                self.assertGreaterEqual(result["aiScore"], 0)
                self.assertLessEqual(result["aiScore"], 1)
                self.assertEqual(engine.runtime_info()["modelSize"], size)

    def test_manifest_cannot_load_weights_for_wrong_variant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.checkpoint("large", root)
            (root / "large" / "manifest.json").write_text(json.dumps(model_source("base").manifest()))
            with patch("engine.model_source", return_value=source), self.assertRaisesRegex(RuntimeError, "revision differs"):
                Engine(Settings("auto", "test", 1, 100000, device="cpu", model="large", model_dir=root))
