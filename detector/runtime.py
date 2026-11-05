"""Device selection shared by startup and dependency-free contract tests."""


def select_device(requested, cuda_available):
    if requested == "cuda":
        if not cuda_available:
            raise RuntimeError(
                "CUDA was requested but PyTorch cannot access an NVIDIA GPU. "
                "Check the NVIDIA driver, Docker GPU access and GPU reservation. "
                "No CPU inference was started."
            )
        return "cuda:0"
    if requested == "auto":
        return "cuda:0" if cuda_available else "cpu"
    if requested == "cpu":
        return "cpu"
    raise RuntimeError("Unknown inference device")
