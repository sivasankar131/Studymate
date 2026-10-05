"""Document upload and management endpoints — with browser-level isolation.

Key safety properties
---------------------
* _run_ingestion() ALWAYS reaches a terminal state (ready | failed).
  - A threading.Event deadline fires if the job exceeds INDEXING_TIMEOUT_SECONDS.
  - Every stage is wrapped in try/except; the outermost handler catches anything
    that slips through.
  - finally: db.close() always runs.
* Duplicate-job guard: upload only starts a background task when the document
  is in the initial "queued" state; a restart of an already-indexing document
  is rejected until the record is manually marked "failed".
"""
import logging
import os
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal, get_db
from app.db.models import Document
from app.dependencies import get_client_id
from app.rag.ingest import delete_document_vectors

log = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt"}

# Status constants — keep in sync with frontend IN_PROGRESS set
STATUS_QUEUED     = "queued"
STATUS_PROCESSING = "processing"
STATUS_INDEXING   = "indexing"
STATUS_READY      = "ready"
STATUS_FAILED     = "failed"


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    filename: str
    num_pages: int
    num_chunks: int
    created_at: datetime
    updated_at: datetime
    status: str
    progress: int
    error_message: str | None = None


class DocumentStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    filename: str
    status: str
    progress: int
    num_pages: int
    num_chunks: int
    error_message: str | None = None


# ─── Background ingestion task ────────────────────────────────────────────────

def _run_ingestion(doc_id: str, client_id: str, data: bytes, filename: str) -> None:
    """
    Runs in a background thread (FastAPI BackgroundTasks).

    Safety guarantees
    -----------------
    1. Hard deadline via threading.Event — if the job hasn't finished within
       INDEXING_TIMEOUT_SECONDS, the DB record is marked failed so the frontend
       unblocks.  The thread itself may continue (Python can't kill a thread),
       but it will eventually complete/fail on its own and its final DB write
       will be a no-op because the record is already in a terminal state.
    2. Every stage sets status=failed + error_message on any exception.
    3. The outermost except clause is a last-resort catch-all.
    4. db.close() is guaranteed by finally.
    """
    t_total = time.perf_counter()
    timeout_secs = settings.INDEXING_TIMEOUT_SECONDS
    deadline_fired = threading.Event()

    # ── Deadline timer ────────────────────────────────────────────────────────
    def _fire_deadline() -> None:
        deadline_fired.set()
        log.error(
            "[INGEST] TIMEOUT  doc_id=%s  limit=%ds — marking failed",
            doc_id, timeout_secs,
        )
        # Open a fresh session for the timeout write (the main thread may have
        # a transaction in progress or the session may be closed already)
        _db = SessionLocal()
        try:
            _db.query(Document).filter(
                Document.id == doc_id,
                Document.status.in_([STATUS_PROCESSING, STATUS_INDEXING]),
            ).update({
                "status":        STATUS_FAILED,
                "progress":      0,
                "error_message": (
                    f"Indexing timed out after {timeout_secs}s. "
                    "Please try uploading again."
                ),
                "updated_at":    datetime.now(timezone.utc),
            })
            _db.commit()
        except Exception:
            log.exception("[INGEST] Failed to write timeout status  doc_id=%s", doc_id)
        finally:
            _db.close()

    timer = threading.Timer(timeout_secs, _fire_deadline)
    timer.daemon = True
    timer.start()

    log.info("[INGEST] start  doc_id=%s  client=%s  filename=%s  size=%.2fKB  timeout=%ds",
             doc_id, client_id[:8], filename, len(data) / 1024, timeout_secs)

    def _set(db: Session, **kwargs) -> None:
        """Update document fields — skips if deadline has already fired."""
        if deadline_fired.is_set():
            return  # don't overwrite the timeout-failure record
        kwargs["updated_at"] = datetime.now(timezone.utc)
        db.query(Document).filter(Document.id == doc_id).update(kwargs)
        db.commit()

    db = SessionLocal()
    try:
        # ── Stage 1: extraction ───────────────────────────────────────────────
        _set(db, status=STATUS_PROCESSING, progress=10)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import extract_pages
            pages = extract_pages(data, filename)
        except ValueError as exc:
            log.warning("[INGEST] extraction failed  doc_id=%s  reason=%s", doc_id, exc)
            _set(db, status=STATUS_FAILED, progress=0, error_message=str(exc))
            return
        log.info("[INGEST] extraction  pages=%d  elapsed=%.2fs", len(pages), time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Stage 2: chunking ─────────────────────────────────────────────────
        _set(db, status=STATUS_PROCESSING, progress=30)
        t0 = time.perf_counter()
        try:
            from langchain_text_splitters import RecursiveCharacterTextSplitter
            from langchain_core.documents import Document as LCDoc
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=settings.CHUNK_SIZE,
                chunk_overlap=settings.CHUNK_OVERLAP,
            )
            chunks: list = []
            for page_no, text_content in pages:
                if deadline_fired.is_set():
                    return
                for piece in splitter.split_text(text_content):
                    if piece.strip():
                        chunks.append(LCDoc(
                            page_content=piece,
                            metadata={
                                "client_id": client_id,
                                "doc_id":    doc_id,
                                "source":    filename,
                                "page":      page_no,
                                "chunk":     len(chunks),
                            },
                        ))
        except Exception:
            log.exception("[INGEST] chunking failed  doc_id=%s", doc_id)
            _set(db, status=STATUS_FAILED, progress=0,
                 error_message="Text chunking failed. Please try again.")
            return

        if not chunks:
            _set(db, status=STATUS_FAILED, progress=0,
                 error_message=(
                     "No readable text found. "
                     "Scanned or image-only PDFs need OCR, which is not supported."
                 ))
            return
        log.info("[INGEST] chunking  chunks=%d  elapsed=%.2fs", len(chunks), time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Stage 3: embedding + Qdrant insertion ─────────────────────────────
        _set(db, status=STATUS_INDEXING, progress=55)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import get_store, BATCH_SIZE
            store = get_store()
            total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE
            for batch_idx, i in enumerate(range(0, len(chunks), BATCH_SIZE)):
                if deadline_fired.is_set():
                    return
                store.add_documents(chunks[i: i + BATCH_SIZE])
                # Update progress every batch, but only write to DB every
                # other batch to avoid hammering Postgres
                if batch_idx % 2 == 0 or batch_idx == total_batches - 1:
                    pct = 55 + int(((batch_idx + 1) / total_batches) * 40)
                    _set(db, status=STATUS_INDEXING, progress=min(pct, 95))
        except Exception:
            log.exception("[INGEST] Qdrant insertion failed  doc_id=%s", doc_id)
            try:
                delete_document_vectors(doc_id, client_id)
            except Exception:
                log.warning("[INGEST] cleanup of partial vectors failed  doc_id=%s", doc_id)
            _set(db, status=STATUS_FAILED, progress=0,
                 error_message="Document indexing failed. Please try again.")
            return
        log.info("[INGEST] embedding+insertion  elapsed=%.2fs", time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Done ──────────────────────────────────────────────────────────────
        if not deadline_fired.is_set():
            db.query(Document).filter(Document.id == doc_id).update({
                "status":     STATUS_READY,
                "progress":   100,
                "num_pages":  len(pages),
                "num_chunks": len(chunks),
                "updated_at": datetime.now(timezone.utc),
            })
            db.commit()
            log.info(
                "[INGEST] complete  doc_id=%s  pages=%d  chunks=%d  total=%.2fs",
                doc_id, len(pages), len(chunks), time.perf_counter() - t_total,
            )

    except Exception:
        log.exception("[INGEST] unexpected error  doc_id=%s", doc_id)
        try:
            _set(db, status=STATUS_FAILED, progress=0,
                 error_message="Unexpected error during processing.")
        except Exception:
            log.exception("[INGEST] could not write failure status  doc_id=%s", doc_id)
    finally:
        timer.cancel()   # cancel if job finished before deadline
        db.close()


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DocumentOut, status_code=202)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    filename = os.path.basename(file.filename or "")
    ext = os.path.splitext(filename)[1].lower()
    log.info("[UPLOAD] received  client=%s  filename=%s", client_id[:8], filename)

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f'"{ext or "unknown"}" files are not supported. Please upload PDF or TXT files.',
        )

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. Maximum allowed size is {settings.MAX_UPLOAD_MB} MB.",
        )
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")

    doc = Document(filename=filename, client_id=client_id, status=STATUS_QUEUED, progress=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(_run_ingestion, doc.id, client_id, data, filename)
    log.info("[UPLOAD] queued  doc_id=%s  client=%s", doc.id, client_id[:8])
    return doc


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    return (
        db.query(Document)
        .filter(Document.client_id == client_id)
        .order_by(Document.created_at.desc())
        .all()
    )


@router.get("/documents/{doc_id}/status", response_model=DocumentStatusOut)
def document_status(
    doc_id: str,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    doc = db.get(Document, doc_id)
    if doc is None or doc.client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    doc = db.get(Document, doc_id)
    if doc is None or doc.client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        delete_document_vectors(doc_id, client_id)
    except Exception as exc:
        log.exception("[DELETE] vector deletion failed  doc_id=%s", doc_id)
        raise HTTPException(status_code=502, detail="Could not reach the vector store.") from exc
    db.delete(doc)
    db.commit()
    log.info("[DELETE] done  doc_id=%s  client=%s", doc_id, client_id[:8])
    return Response(status_code=204)
