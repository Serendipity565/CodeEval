"""Read the same YAML configuration as the API; no extra env file or token."""

from dataclasses import dataclass
import hashlib
import hmac
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Settings:
    provider: str
    token: str
    cpu_threads: int
    max_code_bytes: int
    device: str = "cuda"
    model_dir: Path = Path("/models")
    max_chunks: int = 64

    @property
    def local_enabled(self):
        return self.provider in ("auto", "droiddetect")


def load_settings(path="/app/config.yaml"):
    with open(path, encoding="utf-8") as source:
        config = yaml.safe_load(source) or {}
    detection = config.get("ai_detection") or {}
    secret = (config.get("jwt") or {}).get("secret", "")
    if not isinstance(secret, str) or not secret:
        raise RuntimeError("jwt.secret must be configured in config.yaml")
    provider = str(detection.get("provider") or "auto").strip().lower() or "auto"
    if provider == "ds":
        provider = "deepseek"
    if provider == "llmsniffer":  # Compatibility with existing shared YAML files.
        provider = "droiddetect"
    if provider not in ("auto", "droiddetect", "deepseek"):
        raise RuntimeError("ai_detection.provider must be auto, droiddetect or deepseek (ds)")
    threads = int(detection.get("cpu_threads") or 4)
    if not 1 <= threads <= 32:
        raise RuntimeError("ai_detection.cpu_threads must be between 1 and 32")
    device = str(detection.get("device") or "cuda").strip().lower() or "cuda"
    if device not in ("cuda", "cpu", "auto"):
        raise RuntimeError("ai_detection.device must be cuda, cpu or auto")
    # The HTTP API and Pydantic schema share a fixed 100 KB upper bound.
    max_bytes = min(int((config.get("deepseek") or {}).get("max_code_bytes") or 100000), 100000)
    if max_bytes < 1:
        raise RuntimeError("deepseek.max_code_bytes must be positive")
    token = hmac.new(secret.encode(), b"codeeval-local-detector-v1", hashlib.sha256).hexdigest()
    return Settings(provider=provider, token=token, cpu_threads=threads, max_code_bytes=max_bytes, device=device)
