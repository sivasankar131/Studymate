"""StudyMate API entry point: app, CORS, routers and startup.

Startup is intentionally lightweight so Render detects the open port quickly:
  1. Initialize the database (fast – just DDL if needed)
  2. Ping Qdrant to verify connectivity (fast – no model loading)
  3. Bind to 0.0.0.0:$PORT  ← Render port scanner passes here
  4. Everything else (embedding model, LLM) is lazy – loaded on first use

CORS notes:
  - CORSMiddleware is added FIRST, before any router, so it runs on every
    request including errors and 404s.
  - allow_origins is built from FRONTEND_URL env var (comma-separated list).
  - allow_origins_regex also permits Netlify deploy-preview URLs automatically.
  - A custom exception handler ensures CORS headers are present even on 500s.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
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
    try:
        get_client().get_collections()
        log.info("[STARTUP] qdrant reachable")
    except Exception:
        log.warning(
            "[STARTUP] could not reach Qdrant at startup; will retry on first use",
            exc_info=True,
        )

    log.info("[STARTUP] application ready — listening on 0.0.0.0:$PORT")
    log.info("[STARTUP] CORS allowed origins: %s", settings.cors_origins)

    yield


app = FastAPI(
    title="StudyMate API",
    description="Upload your documents and ask questions. RAG + agent backend.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Must be added BEFORE routers so it runs on every request, including errors.
#
# allow_origins       – exact origins from FRONTEND_URL env var
# allow_origin_regex  – also permits Netlify deploy-preview subdomains
#                       (https://deploy-preview-*--ragwise.netlify.app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.netlify\.app",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
    expose_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(upload.router)
app.include_router(chat.router)


# ── Global exception handler ──────────────────────────────────────────────────
# Starlette's CORSMiddleware injects headers on the way OUT.  When an
# unhandled exception propagates to the ASGI layer it bypasses the normal
# response path, so CORS headers can be missing.  This handler catches all
# uncaught exceptions, logs them, and returns a JSON 500 that CORSMiddleware
# can still annotate (because the handler runs inside the middleware stack).
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again."},
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", tags=["health"])
def root():
    return {"name": "StudyMate API", "docs": "/docs", "health": "/health"}


@app.get("/health", tags=["health"])
def health():
    """Liveness check — returns immediately, no external calls."""
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def ready():
    """Readiness check: verifies Postgres and Qdrant are reachable."""
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
