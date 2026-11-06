"""Configuration contract cases; no PyTorch import or model download needed."""
import hashlib
import hmac
from pathlib import Path
import tempfile
import unittest

from settings import load_settings


class SettingsTests(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            path.write_text(text)
            return load_settings(path)

    def test_existing_yaml_needs_no_extra_detection_secret(self):
        settings = self.read("jwt:\n  secret: shared-test-secret\n")
        self.assertTrue(settings.local_enabled)
        self.assertEqual(settings.cpu_threads, 4)
        self.assertEqual(settings.device, "cuda")
        expected = hmac.new(b"shared-test-secret", b"codeeval-local-detector-v1", hashlib.sha256).hexdigest()
        self.assertEqual(settings.token, expected)

    def test_ds_and_deepseek_both_disable_local_weights(self):
        for name in ["ds", "deepseek"]:
            settings = self.read(f"jwt:\n  secret: shared-test-secret\nai_detection:\n  provider: {name}\n")
            self.assertEqual(settings.provider, "deepseek")
            self.assertFalse(settings.local_enabled)

    def test_unsupported_provider_is_rejected(self):
        with self.assertRaises(RuntimeError):
            self.read("jwt:\n  secret: shared-test-secret\nai_detection:\n  provider: unknown\n")

    def test_droiddetect_and_legacy_provider_load_local_model(self):
        for name in ("droiddetect", "llmsniffer"):
            settings = self.read(f"jwt:\n  secret: shared-test-secret\nai_detection:\n  provider: {name}\n")
            self.assertEqual(settings.provider, "droiddetect")
            self.assertTrue(settings.local_enabled)

    def test_cpu_and_auto_device_can_be_selected_in_the_same_yaml(self):
        for device in ("cpu", "auto"):
            settings = self.read(f"jwt:\n  secret: shared-test-secret\nai_detection:\n  device: {device}\n")
            self.assertEqual(settings.device, device)

    def test_invalid_device_is_rejected(self):
        with self.assertRaises(RuntimeError):
            self.read("jwt:\n  secret: shared-test-secret\nai_detection:\n  device: invalid\n")


if __name__ == "__main__":
    unittest.main()
