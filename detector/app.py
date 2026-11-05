"""Docker HTTP adapter. All user settings come from the shared config.yaml."""

import asyncio
from contextlib import asynccontextmanager
import logging
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from model_sources import SUPPORTED_LANGUAGES, VERSION, normalize_language
from settings import load_settings

settings = load_settings()
logger = logging.getLogger("uvicorn.error")


class DetectionInput(BaseModel):
    language: str = Field(min_length=1, max_length=32)
    code: str = Field(min_length=1, max_length=100000)


@asynccontextmanager
async def lifespan(app):
    app.state.engine = None
    if settings.local_enabled:
        # Selecting DS neither imports PyTorch nor loads/downloads weights.
        from engine import Engine
        app.state.engine = await asyncio.to_thread(Engine, settings)
    yield


app = FastAPI(title="CodeEval local code classifier", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def body_limit(request, call_next):
    if request.method == "POST":
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > settings.max_code_bytes * 6 + 4096:
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=413, content={"detail": "请求体超过检测上限"})
            chunks.append(chunk)
        request._body = b"".join(chunks)
    return await call_next(request)


def authorize(authorization: str = Header(default="")):
    if not secrets.compare_digest(authorization.encode(), ("Bearer " + settings.token).encode()):
        raise HTTPException(401, detail="Invalid detector token")


@app.get("/healthz")
def health():
    engine = app.state.engine
    return {
        "status": "ready" if engine is not None else "disabled",
        "languages": sorted(SUPPORTED_LANGUAGES) if engine is not None else [],
        "version": VERSION,
        **(engine.runtime_info() if engine is not None else {"device": "none"}),
    }


@app.post("/v1/detect", dependencies=[Depends(authorize)])
def detect(payload: DetectionInput):
    if app.state.engine is None:
        raise HTTPException(503, detail="当前配置使用 DeepSeek，本地分类器未加载")
    language = normalize_language(payload.language)
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(422, detail="本地分类器支持 Python、Java、C++ 和 Go")
    if not payload.code.strip() or len(payload.code.encode()) > settings.max_code_bytes:
        raise HTTPException(413, detail="代码为空或超过字节上限；未生成分数")
    try:
        return app.state.engine.detect(payload.code, language)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Local classifier inference failed")
        raise HTTPException(503, detail="本地分类器推理失败；未生成分数") from None
