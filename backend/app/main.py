"""StudyMate API entry point: app, CORS, routers and startup."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.db.database import engine, init_db
from app.rag.ingest import ensure_collection, get_client
from app.routes import chat, upload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("studymate")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()  # fail fast if the database is unreachable
    try:
        ensure_collection()
    except Exception:
        log.exception("Could not prepare the Qdrant collection at startup; it will be retried on first use.")
    yield


app = FastAPI(
    title="StudyMate API",
    description="Upload your documents and ask questions. RAG + agent backend.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(chat.router)


@app.get("/", tags=["health"])
def root():
    return {"name": "StudyMate API", "docs": "/docs", "health": "/health"}


@app.get("/health", tags=["health"])
def health():
    """Liveness check (does not touch any external service)."""
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def ready():
    """Readiness check: can the API reach Postgres and Qdrant?"""
    checks: dict[str, str] = {}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
    try:
        get_client().get_collections()
        checks["vector_store"] = "ok"
    except Exception as exc:
        checks["vector_store"] = f"error: {type(exc).__name__}"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "ok" if all_ok else "degraded", **checks},
    )
