"""Document upload and management endpoints — with browser-level isolation.

Threading design (Render free tier, 512 MB RAM)
------------------------------------------------
ProcessPoolExecutor was tried but rejected: a subprocess needs to load
torch (~400 MB) into a SECOND Python process.  On a 512 MB free-tier
instance the main process already uses ~100 MB, leaving ~400 MB — right
at the edge.  Under real load the subprocess was OOM-killed silently,
leaving documents stuck at "processing" forever.

Current approach: run _run_ingestion() in a plain daemon thread.

Why this is acceptable:
  - Python's GIL is released during C-extension work AND during I/O.
  - The embedding model (HuggingFaceEmbeddings) calls PyTorch internals
    that release the GIL for the actual matrix multiply.
  - The Qdrant insertion step is pure network I/O — GIL released entirely.
  - PDF parsing (PyPDF) is I/O + light CPU — GIL released frequently.
  - The only phase that holds the GIL is Python-level text processing
    (chunking, string slicing) which is fast and bounded.
  - Result: event loop stalls for milliseconds at a time, not seconds.

For a fully non-blocking solution, upgrade to Render Standard (1 GB RAM)
which can safely run the ProcessPoolExecutor approach.

Safety guarantees
-----------------
* Hard deadline via threading.Timer marks the document failed if the
  thread hangs (OOM, Qdrant timeout, etc.).
* Every stage has try/except — always reaches a terminal state.
* Temp file deleted in finally.
* db.close() guaranteed by finally.
"""
import gc
import logging
import os
import tempfile
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


# ─── DB helpers ───────────────────────────────────────────────────────────────

def _set_status(doc_id: str, status: str, progress: int, **extra) -> None:
    """Open a fresh DB session, update the document, close the session."""
    db = SessionLocal()
    try:
        db.query(Document).filter(Document.id == doc_id).update({
            "status":     status,
            "progress":   progress,
            "updated_at": datetime.now(timezone.utc),
            **extra,
        })
        db.commit()
    except Exception:
        log.exception("[INGEST] DB update failed  doc_id=%s  status=%s", doc_id, status)
    finally:
        db.close()


# ─── Background ingestion (daemon thread, one per upload) ─────────────────────

def _run_ingestion(doc_id: str, client_id: str, tmp_path: str, filename: str) -> None:
    """
    Runs in a daemon thread.  Every expensive step is wrapped in try/except.
    The document ALWAYS transitions to ready or failed — never stays stuck.

    Memory management
    -----------------
    Explicit `del` + `gc.collect()` between stages keeps peak RSS low.
    This matters on the 512 MB Render free tier where torch occupies ~400 MB.
    """
    t_total = time.perf_counter()
    timeout_secs   = settings.INDEXING_TIMEOUT_SECONDS
    deadline_fired = threading.Event()

    # ── Hard deadline timer ───────────────────────────────────────────────────
    def _fire_deadline() -> None:
        deadline_fired.set()
        log.error("[INGEST] TIMEOUT  doc_id=%s  limit=%ds", doc_id, timeout_secs)
        _set_status(doc_id, STATUS_FAILED, 0,
                    error_message=f"Indexing timed out after {timeout_secs}s. Please try uploading again.")

    timer = threading.Timer(timeout_secs, _fire_deadline)
    timer.daemon = True
    timer.start()

    log.info("[INGEST] start  doc_id=%s  client=%s  filename=%s  timeout=%ds",
             doc_id, client_id[:8], filename, timeout_secs)

    try:
        # ── Stage 1: read temp file ───────────────────────────────────────────
        _set_status(doc_id, STATUS_PROCESSING, 5)
        try:
            with open(tmp_path, "rb") as fh:
                data = fh.read()
        except Exception as exc:
            log.exception("[INGEST] cannot read temp file  doc_id=%s", doc_id)
            _set_status(doc_id, STATUS_FAILED, 0,
                        error_message="Could not read the uploaded file. Please try again.")
            return

        if deadline_fired.is_set():
            return

        # ── Stage 2: extract pages ────────────────────────────────────────────
        _set_status(doc_id, STATUS_PROCESSING, 15)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import extract_pages
            pages = extract_pages(data, filename)
        except ValueError as exc:
            log.warning("[INGEST] extraction failed  doc_id=%s  reason=%s", doc_id, exc)
            _set_status(doc_id, STATUS_FAILED, 0, error_message=str(exc))
            return
        finally:
            del data
            gc.collect()   # free the raw bytes before loading torch

        log.info("[INGEST] extraction  pages=%d  %.2fs", len(pages), time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Stage 3: chunk ────────────────────────────────────────────────────
        _set_status(doc_id, STATUS_PROCESSING, 35)
        t0 = time.perf_counter()
        try:
            from langchain_text_splitters import RecursiveCharacterTextSplitter
            from langchain_core.documents import Document as LCDoc

            splitter = RecursiveCharacterTextSplitter(
                chunk_size=settings.CHUNK_SIZE,
                chunk_overlap=settings.CHUNK_OVERLAP,
            )
            chunks: list[LCDoc] = []
            num_pages = len(pages)
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
            _set_status(doc_id, STATUS_FAILED, 0,
                        error_message="Text chunking failed. Please try again.")
            return
        finally:
            del pages
            gc.collect()   # free page text before loading embedding model

        if not chunks:
            _set_status(doc_id, STATUS_FAILED, 0,
                        error_message="No readable text found. Scanned PDFs need OCR, which is not supported.")
            return

        num_chunks = len(chunks)
        log.info("[INGEST] chunking  chunks=%d  %.2fs", num_chunks, time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Stage 4: embed + insert (GIL released during torch + network I/O) ─
        _set_status(doc_id, STATUS_INDEXING, 55)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import get_store, BATCH_SIZE
            store = get_store()   # torch loads here (lazy, @lru_cache)
            total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE
            for batch_idx, i in enumerate(range(0, len(chunks), BATCH_SIZE)):
                if deadline_fired.is_set():
                    return
                store.add_documents(chunks[i: i + BATCH_SIZE])
                if batch_idx % 2 == 0 or batch_idx == total_batches - 1:
                    pct = 55 + int(((batch_idx + 1) / total_batches) * 40)
                    _set_status(doc_id, STATUS_INDEXING, min(pct, 95))
        except Exception:
            log.exception("[INGEST] embedding/insertion failed  doc_id=%s", doc_id)
            try:
                delete_document_vectors(doc_id, client_id)
            except Exception:
                pass
            _set_status(doc_id, STATUS_FAILED, 0,
                        error_message="Document indexing failed. Please try again.")
            return
        finally:
            del chunks
            gc.collect()

        log.info("[INGEST] embedding+insertion  %.2fs", time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Done ──────────────────────────────────────────────────────────────
        _db = SessionLocal()
        try:
            _db.query(Document).filter(Document.id == doc_id).update({
                "status":     STATUS_READY,
                "progress":   100,
                "num_pages":  num_pages,
                "num_chunks": num_chunks,
                "updated_at": datetime.now(timezone.utc),
            })
            _db.commit()
        finally:
            _db.close()

        log.info("[INGEST] complete  doc_id=%s  pages=%d  chunks=%d  total=%.2fs",
                 doc_id, num_pages, num_chunks, time.perf_counter() - t_total)

    except Exception:
        log.exception("[INGEST] unexpected error  doc_id=%s", doc_id)
        if not deadline_fired.is_set():
            _set_status(doc_id, STATUS_FAILED, 0,
                        error_message="Unexpected error during processing.")
    finally:
        timer.cancel()
        try:
            os.unlink(tmp_path)
        except OSError:
            log.warning("[INGEST] could not delete temp file  path=%s", tmp_path)


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DocumentOut, status_code=202)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """
    Stream file to temp file → create DB record → return 202 → ingest in background thread.
    The main uvicorn process never holds the bytes buffer while indexing.
    """
    filename = os.path.basename(file.filename or "")
    ext = os.path.splitext(filename)[1].lower()
    log.info("[UPLOAD] received  client=%s  filename=%s", client_id[:8], filename)

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f'"{ext or "unknown"}" files are not supported. Please upload PDF or TXT files.',
        )

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024

    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=ext, prefix="studymate_upload_",
        ) as tmp:
            bytes_written = 0
            for chunk in iter(lambda: file.file.read(65_536), b""):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    tmp_path_for_cleanup = tmp.name
                    try:
                        os.unlink(tmp_path_for_cleanup)
                    except OSError:
                        pass
                    raise HTTPException(
                        status_code=413,
                        detail=f"File is too large. Maximum allowed size is {settings.MAX_UPLOAD_MB} MB.",
                    )
                tmp.write(chunk)
            tmp_path = tmp.name
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("[UPLOAD] failed to save temp file  filename=%s", filename)
        raise HTTPException(status_code=500, detail="Could not save the uploaded file.") from exc

    if bytes_written == 0:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="The file is empty.")

    log.info("[UPLOAD] saved  filename=%s  size=%.2fMB", filename, bytes_written / 1024 / 1024)

    doc = Document(filename=filename, client_id=client_id, status=STATUS_QUEUED, progress=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(_run_ingestion, doc.id, client_id, tmp_path, filename)
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
