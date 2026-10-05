"""StudyMate API entry point: app, CORS, routers and startup.

Startup is intentionally lightweight so Render detects the open port quickly:
  1. Initialize the database (fast – just DDL if needed)
  2. Ping Qdrant to verify connectivity (fast – no model loading)
  3. Bind to 0.0.0.0:$PORT  ← Render port scanner passes here
  4. Everything else (embedding model, LLM) is lazy – loaded on first use
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.db.database import engine, init_db
from app.rag.ingest import get_client
from app.routes import chat, upload

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("studymate")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # ── 1. Database ───────────────────────────────────────────────────────────
    try:
        init_db()
        log.info("[STARTUP] database ready")
    except Exception:
        log.exception("[STARTUP] database initialization failed; API will still start")

    # ── 2. Qdrant connectivity (lightweight ping only — NO model loading) ─────
    # We only verify the client can reach Qdrant.
    # ensure_collection() is intentionally NOT called here because it may
    # trigger get_embeddings() if the collection doesn't exist yet.
    # The collection will be created on first upload instead.
    try:
        get_client().get_collections()   # cheap HTTP GET — no embeddings involved
        log.info("[STARTUP] qdrant reachable")
    except Exception:
        log.warning(
            "[STARTUP] could not reach Qdrant at startup; will retry on first use",
            exc_info=True,
        )

    # ── 3. Server is now ready to accept requests ─────────────────────────────
    # The embedding model (BAAI/bge-small-en-v1.5) is NOT loaded here.
    # It will be loaded lazily on the first document upload/retrieval.
    log.info("[STARTUP] application ready — listening on 0.0.0.0:$PORT")

    yield
    # Nothing to clean up on shutdown.


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
    allow_credentials=True,
)

app.include_router(upload.router)
app.include_router(chat.router)


@app.get("/", tags=["health"])
def root():
    return {"name": "StudyMate API", "docs": "/docs", "health": "/health"}


@app.get("/health", tags=["health"])
def health():
    """Liveness check — returns immediately, no external calls."""
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def ready():
    """Readiness check: verifies Postgres and Qdrant are reachable.
    Does NOT load the embedding model."""
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
