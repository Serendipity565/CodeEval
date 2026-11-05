FROM python:3.11-slim-bookworm
ARG TARGETARCH
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HOME=/tmp/hf-cache \
    TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=4 \
    HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DOWNLOAD_TIMEOUT=120 \
    CUDA_CACHE_PATH=/tmp/cuda-cache
WORKDIR /app
COPY requirements.txt ./
# CUDA 12.4 wheels include the user-space runtime for NVIDIA GPU inference.
# Other native architectures retain a CPU wheel in this same Dockerfile.
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124; \
    else pip install --no-cache-dir torch==2.6.0; fi \
    && pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home detector \
    && mkdir -p /models && chown detector:detector /models
COPY --chown=detector:detector *.py ./
USER detector
EXPOSE 8010
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1", "--limit-concurrency", "8", "--no-access-log"]
