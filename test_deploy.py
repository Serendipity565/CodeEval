"""Deployment selection without Docker, network or real application secrets."""

from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import yaml
import deploy


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "server").mkdir()
        shutil.copy(deploy.ROOT / "docker-compose.yaml", self.root)

    def config(self, detection=""):
        (self.root / "server" / "config.yaml").write_text(
            "jwt:\n  secret: test-secret\nai_detection:\n" + detection)
        return deploy.compose_config(self.root)

    def test_base_and_large_are_exclusive_and_preserve_service_dns_and_volumes(self):
        for size, memory in (("base", "6g"), ("large", "8g")):
            services = self.config(f"  model: {size}\n")["services"]
            self.assertEqual(services["droiddetect"]["container_name"], "codeeval-droiddetect-" + size)
            self.assertEqual(services["droiddetect"]["mem_limit"], memory)
            self.assertEqual(services["droiddetect"]["volumes"][-1], "detector_models:/models:ro")
            self.assertIn("droiddetect", services["server"]["depends_on"])
            self.assertEqual(services["droiddetect"]["deploy"]["resources"]["reservations"]["devices"][0]["count"], 1)
            self.assertEqual(sum(name.startswith("droiddetect") for name in services), 1)

    def test_deepseek_needs_no_detector_image_or_gpu(self):
        for provider in ("ds", "deepseek"):
            result = self.config(f"  provider: {provider}\n")
            self.assertNotIn("droiddetect", result["services"])
            self.assertNotIn("model-init", result["services"])
            self.assertNotIn("droiddetect", result["services"]["server"]["depends_on"])
            self.assertIn("detector_models", result["volumes"])

    def test_cpu_does_not_request_gpu(self):
        self.assertNotIn("deploy", self.config("  device: cpu\n")["services"]["droiddetect"])

    def test_config_edits_recreate_all_readers_including_completed_initializer(self):
        first = self.config("  model: base\n")["services"]
        second = self.config("  model: large\n")["services"]
        for name in ("server", "sandbox-runner", "droiddetect", "model-init"):
            self.assertNotEqual(first[name]["environment"]["CODEEVAL_CONFIG_REVISION"],
                                second[name]["environment"]["CODEEVAL_CONFIG_REVISION"])

    def test_custom_detector_environment_is_preserved(self):
        compose_path = self.root / "docker-compose.yaml"
        original = yaml.safe_load(compose_path.read_text())
        for name in ("droiddetect", "model-init"):
            original["services"][name]["environment"] = {"HF_ENDPOINT": "https://example.test"}
        compose_path.write_text(yaml.safe_dump(original))
        services = self.config("  model: large\n")["services"]
        for name in ("droiddetect", "model-init"):
            self.assertEqual(services[name]["environment"]["HF_ENDPOINT"], "https://example.test")

    def test_launcher_removes_old_containers_and_preserves_project_directory(self):
        document = self.config("  model: large\n")
        captured = {}

        def run(command, **kwargs):
            captured["command"] = command
            generated = Path(command[command.index("-f") + 1])
            self.assertEqual(yaml.safe_load(generated.read_text()), document)
            self.assertEqual(generated.stat().st_mode & 0o777, 0o600)
            return type("Result", (), {"returncode": 0})()

        with patch.object(deploy, "compose_config", return_value=document), patch.object(deploy.subprocess, "run", side_effect=run):
            self.assertEqual(deploy.main(["up", "-d"]), 0)
        self.assertIn("--remove-orphans", captured["command"])
        self.assertEqual(captured["command"][3], str(deploy.ROOT))
        self.assertNotIn("test-secret", str(captured))


if __name__ == "__main__":
    unittest.main()
