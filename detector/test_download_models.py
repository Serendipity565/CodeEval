"""Cache isolation, legacy reuse and failed downloads, without network access."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from download_models import download
from model_sources import CHECKPOINT_FILES, model_source
from settings import Settings


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.calls = []

    def settings(self, size, provider="auto"):
        return Settings(provider, "test", 1, 100000, model=size, model_dir=self.root)

    def fake_download(self, repo, revision, local_dir, allow_patterns):
        self.calls.append((repo, revision))
        local_dir.mkdir(parents=True, exist_ok=True)
        for name in allow_patterns:
            (local_dir / name).write_text("test-artifact")

    def test_switching_back_reuses_original_base_and_retains_large(self):
        with patch("download_models.snapshot_download", side_effect=self.fake_download):
            download(self.settings("base"))
            self.assertTrue((self.root / "manifest.json").exists())
            download(self.settings("large"))
            self.assertEqual(json.loads((self.root / "large" / "manifest.json").read_text()), model_source("large").manifest())
            download(self.settings("base"))
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(self.calls[3][0], "project-droid/DroidDetect-Large-Binary")
        for name in CHECKPOINT_FILES:
            self.assertTrue((self.root / "droiddetect" / name).exists())
            self.assertTrue((self.root / "large" / "droiddetect" / name).exists())

    def test_incomplete_or_wrong_revision_cache_is_repaired(self):
        with patch("download_models.snapshot_download", side_effect=self.fake_download):
            download(self.settings("large"))
            (self.root / "large" / "droiddetect" / "pytorch_model.bin").unlink()
            download(self.settings("large"))
            (self.root / "large" / "manifest.json").write_text("{}")
            download(self.settings("large"))
        self.assertEqual(len(self.calls), 6)

    def test_failure_does_not_mark_cache_complete(self):
        with patch("download_models.snapshot_download", side_effect=RuntimeError("offline")):
            with self.assertRaises(RuntimeError):
                download(self.settings("large"))
        self.assertFalse((self.root / "large" / "manifest.json").exists())

    def test_ds_downloads_neither_model(self):
        with patch("download_models.snapshot_download") as snapshot:
            download(self.settings("large", "deepseek"))
        snapshot.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])
