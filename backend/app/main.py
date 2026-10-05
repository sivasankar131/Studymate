"""StudyMate API entry point: app, CORS, routers and startup.

Startup sequence
----------------
1. Database init (fast — DDL only if needed)
2. Qdrant connectivity ping (cheap, no model loading)
3. Start stale-job watchdog (async background task)
4. Bind to 0.0.0.0:$PORT  ← Render port scanner passes here

The stale-job watchdog runs every 60 s and marks as "failed" any document
that has been stuck in "processing" or "indexing" for longer than
INDEXING_STALE_MINUTES.  This self-heals records left by crashed workers.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.db.database import SessionLocal, engine, init_db
from app.db.models import Document
from app.rag.ingest import get_client
from app.routes import chat, upload

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("studymate")

# Status values that mean "still running" — must stay in sync with upload.py
_IN_FLIGHT_STATUSES = ("processing", "indexing", "queued")
_WATCHDOG_INTERVAL  = 60   # seconds between sweeps


async def _stale_job_watchdog() -> None:
    """Async task: marks documents stuck in processing/indexing as failed.

    Runs every _WATCHDOG_INTERVAL seconds.  Uses its own DB session so it
    never interferes with request sessions.  All exceptions are caught so
    a DB hiccup cannot kill the watchdog loop.
    """
    stale_threshold = timedelta(minutes=settings.INDEXING_STALE_MINUTES)
    log.info(
        "[WATCHDOG] started — sweep every %ds, stale threshold %dm",
        _WATCHDOG_INTERVAL, settings.INDEXING_STALE_MINUTES,
    )
    while True:
        try:
            await asyncio.sleep(_WATCHDOG_INTERVAL)
        except asyncio.CancelledError:
            log.info("[WATCHDOG] cancelled — shutting down")
            return

        try:
            cutoff = datetime.now(timezone.utc) - stale_threshold
            db = SessionLocal()
            try:
                stale = (
                    db.query(Document)
                    .filter(
                        Document.status.in_(_IN_FLIGHT_STATUSES),
                        Document.updated_at < cutoff,
                    )
                    .all()
                )
                if stale:
                    for doc in stale:
                        doc.status        = "failed"
                        doc.progress      = 0
                        doc.error_message = (
                            "Indexing timed out or the indexing worker stopped unexpectedly. "
                            "Please try uploading again."
                        )
                        doc.updated_at    = datetime.now(timezone.utc)
                        log.warning(
                            "[WATCHDOG] stale document marked failed  "
                            "doc_id=%s  client=%s  last_updated=%s",
                            doc.id, doc.client_id[:8] if doc.client_id else "?",
                            doc.updated_at.isoformat(),
                        )
                    db.commit()
                    log.info("[WATCHDOG] marked %d stale document(s) as failed", len(stale))
            finally:
                db.close()
        except asyncio.CancelledError:
            log.info("[WATCHDOG] cancelled inside sweep — shutting down")
            return
        except Exception:
            log.exception("[WATCHDOG] sweep error (non-fatal, will retry next cycle)")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # ── 1. Database ───────────────────────────────────────────────────────────
    try:
        init_db()
        log.info("[STARTUP] database ready")
    except Exception:
        log.exception("[STARTUP] database init failed; API will still start")

    # ── 2. Qdrant connectivity ────────────────────────────────────────────────
    try:
        get_client().get_collections()
        log.info("[STARTUP] qdrant reachable")
    except Exception:
        log.warning("[STARTUP] qdrant unreachable at startup; will retry on first use",
                    exc_info=True)

    # ── 3. Stale-job watchdog ─────────────────────────────────────────────────
    watchdog_task = asyncio.create_task(_stale_job_watchdog())

    log.info("[STARTUP] application ready — listening on 0.0.0.0:$PORT")
    log.info("[STARTUP] CORS allowed origins: %s", settings.cors_origins)

    yield  # ← server runs here

    # ── Shutdown: cancel watchdog cleanly ─────────────────────────────────────
    watchdog_task.cancel()
    try:
        await watchdog_task
    except asyncio.CancelledError:
        pass
    log.info("[SHUTDOWN] watchdog stopped")


app = FastAPI(
    title="StudyMate API",
    description="Upload your documents and ask questions. RAG + agent backend.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.netlify\.app",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
    expose_headers=["*"],
)

app.include_router(upload.router)
app.include_router(chat.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again."},
    )


@app.api_route("/", methods=["GET", "HEAD"], tags=["health"])
def root():
    return {"name": "StudyMate API", "docs": "/docs", "health": "/health"}


@app.api_route("/health", methods=["GET", "HEAD"], tags=["health"])
def health():
    return {"status": "ok"}


@app.api_route("/health/ready", methods=["GET", "HEAD"], tags=["health"])
def ready():
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
