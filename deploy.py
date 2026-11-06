"""Select Compose services from server/config.yaml; no model-specific YAML needed.

Usage: python3 deploy.py up -d --build
Requires Python 3 and PyYAML (python3 -m pip install -r requirements-deploy.txt).
All remaining arguments are passed to Docker Compose, e.g. ps, logs, down, exec.
"""

import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

try:
    import yaml
except ImportError:
    raise SystemExit("Install deployment dependencies: python3 -m pip install -r requirements-deploy.txt")

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "detector"))
from settings import load_settings


def compose_config(root=ROOT):
    path = root / "server" / "config.yaml"
    settings = load_settings(path)
    document = yaml.safe_load((root / "docker-compose.yaml").read_text(encoding="utf-8"))
    services = document["services"]
    # Compose otherwise cannot notice edits to the contents of a bind mount.
    revision = hashlib.sha256(path.read_bytes()).hexdigest()
    for name in ("server", "sandbox-runner"):
        services[name].setdefault("environment", {})["CODEEVAL_CONFIG_REVISION"] = revision
    if settings.local_enabled:
        detector = services["droiddetect"]
        detector["container_name"] = "codeeval-droiddetect-" + settings.model
        detector["mem_limit"] = "8g" if settings.model == "large" else "6g"
        detector.setdefault("environment", {})["CODEEVAL_CONFIG_REVISION"] = revision
        services["model-init"].setdefault("environment", {})["CODEEVAL_CONFIG_REVISION"] = revision
        services["model-init"]["mem_limit"] = detector["mem_limit"]
        # CPU deployments must not ask Docker for an NVIDIA device.
        if settings.device == "cpu":
            detector.pop("deploy", None)
    else:
        services.pop("model-init")
        services.pop("droiddetect")
        services["server"]["depends_on"].pop("droiddetect", None)
    return document


def main(args=None):
    args = list(sys.argv[1:] if args is None else args) or ["up", "-d", "--build"]
    if args == ["--help"]:
        print(__doc__)
        return 0
    try:
        document = compose_config()
        # Do not silently enable a second detector or leave the previous one
        # occupying VRAM when switching to DeepSeek. Named volumes are retained.
        if args[0] in ("up", "down") and "--remove-orphans" not in args:
            args.append("--remove-orphans")
        # An explicit project directory preserves service/volume names and the
        # relative paths in the original Compose file. The generated file is
        # private and short-lived; application config remains a bind mount.
        with tempfile.TemporaryDirectory(prefix="codeeval-compose-") as directory:
            path = Path(directory) / "compose.yaml"
            with path.open("w", encoding="utf-8") as target:
                os.chmod(path, 0o600)
                yaml.safe_dump(document, target, sort_keys=False, allow_unicode=True)
            result = subprocess.run(
                ["docker", "compose", "--project-directory", str(ROOT), "-f", str(path), *args],
                cwd=ROOT,
            )
            return result.returncode
    except (OSError, RuntimeError, ValueError, yaml.YAMLError) as error:
        # YAML parser errors can include source lines containing credentials.
        if isinstance(error, yaml.YAMLError):
            print("Deployment failed: invalid YAML; check config.yaml and docker-compose.yaml", file=sys.stderr)
        elif isinstance(error, FileNotFoundError):
            print("Deployment failed: config/Compose file or docker command not found", file=sys.stderr)
        else:
            print(f"Deployment failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
