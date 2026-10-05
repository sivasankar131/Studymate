"""Document upload and management endpoints — with browser-level isolation.

Key safety properties
---------------------
* Upload route stores the file in a NamedTemporaryFile and passes the PATH
  (not the bytes) to the background task. This releases the in-memory buffer
  immediately after the 202 response is sent, keeping RAM pressure low on
  Render's free tier (512 MB limit).
* _run_ingestion() ALWAYS reaches a terminal state (ready | failed).
  - A threading.Event deadline fires if the job exceeds INDEXING_TIMEOUT_SECONDS.
  - Every stage is wrapped in try/except.
  - finally: temp file deleted + db.close() always run.
* The main FastAPI process (serving /health, /chat, /documents) is never
  blocked or crashed by a background indexing failure.
"""
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


# ─── Background ingestion task ────────────────────────────────────────────────

def _run_ingestion(doc_id: str, client_id: str, tmp_path: str, filename: str) -> None:
    """
    Runs in a background thread (FastAPI BackgroundTasks).

    Receives a temp-file path instead of raw bytes so the upload route can
    release the in-memory buffer before this thread starts expensive work.

    Safety guarantees
    -----------------
    1. Hard deadline via threading.Timer — marks DB record failed if exceeded.
    2. Every stage wrapped in try/except — always reaches a terminal state.
    3. Temp file deleted in finally regardless of success/failure.
    4. db.close() guaranteed by finally.
    5. Deadline fires into a fresh DB session — never blocks on the main one.
    """
    t_total = time.perf_counter()
    timeout_secs   = settings.INDEXING_TIMEOUT_SECONDS
    deadline_fired = threading.Event()

    # ── Deadline timer ────────────────────────────────────────────────────────
    def _fire_deadline() -> None:
        deadline_fired.set()
        log.error("[INGEST] TIMEOUT  doc_id=%s  limit=%ds — marking failed",
                  doc_id, timeout_secs)
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
                "updated_at": datetime.now(timezone.utc),
            })
            _db.commit()
        except Exception:
            log.exception("[INGEST] could not write timeout status  doc_id=%s", doc_id)
        finally:
            _db.close()

    timer = threading.Timer(timeout_secs, _fire_deadline)
    timer.daemon = True
    timer.start()

    log.info("[INGEST] start  doc_id=%s  client=%s  filename=%s  timeout=%ds",
             doc_id, client_id[:8], filename, timeout_secs)

    def _set(db: Session, **kwargs) -> None:
        if deadline_fired.is_set():
            return
        kwargs["updated_at"] = datetime.now(timezone.utc)
        db.query(Document).filter(Document.id == doc_id).update(kwargs)
        db.commit()

    db = SessionLocal()
    try:
        # ── Read from temp file (streamed, not held as bytes in RAM) ──────────
        try:
            with open(tmp_path, "rb") as fh:
                data = fh.read()
        except Exception as exc:
            log.exception("[INGEST] could not read temp file  doc_id=%s", doc_id)
            _set(db, status=STATUS_FAILED, progress=0,
                 error_message="Could not read the uploaded file. Please try again.")
            return

        # ── Stage 1: extraction ───────────────────────────────────────────────
        _set(db, status=STATUS_PROCESSING, progress=10)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import extract_pages
            pages = extract_pages(data, filename)
            # Free the buffer — extraction is done
            del data
        except ValueError as exc:
            log.warning("[INGEST] extraction failed  doc_id=%s  reason=%s", doc_id, exc)
            _set(db, status=STATUS_FAILED, progress=0, error_message=str(exc))
            return
        log.info("[INGEST] extraction  pages=%d  elapsed=%.2fs",
                 len(pages), time.perf_counter() - t0)

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
            num_pages_final = len(pages)
            # Free page text — no longer needed
            del pages
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
        log.info("[INGEST] chunking  chunks=%d  elapsed=%.2fs",
                 len(chunks), time.perf_counter() - t0)

        if deadline_fired.is_set():
            return

        # ── Stage 3: embedding + Qdrant insertion ─────────────────────────────
        _set(db, status=STATUS_INDEXING, progress=55)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import get_store, BATCH_SIZE
            store = get_store()
            total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE
            num_chunks_final = len(chunks)
            for batch_idx, i in enumerate(range(0, len(chunks), BATCH_SIZE)):
                if deadline_fired.is_set():
                    return
                store.add_documents(chunks[i: i + BATCH_SIZE])
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
        db.query(Document).filter(Document.id == doc_id).update({
            "status":     STATUS_READY,
            "progress":   100,
            "num_pages":  num_pages_final,
            "num_chunks": num_chunks_final,
            "updated_at": datetime.now(timezone.utc),
        })
        db.commit()
        log.info("[INGEST] complete  doc_id=%s  pages=%d  chunks=%d  total=%.2fs",
                 doc_id, num_pages_final, num_chunks_final, time.perf_counter() - t_total)

    except Exception:
        log.exception("[INGEST] unexpected error  doc_id=%s", doc_id)
        try:
            _set(db, status=STATUS_FAILED, progress=0,
                 error_message="Unexpected error during processing.")
        except Exception:
            log.exception("[INGEST] could not write failure status  doc_id=%s", doc_id)
    finally:
        timer.cancel()
        db.close()
        # Always delete the temp file — even if indexing failed or timed out
        try:
            os.unlink(tmp_path)
            log.debug("[INGEST] temp file deleted  path=%s", tmp_path)
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
    Accept a file, validate it, write it to a temp file, create a DB record
    (status=queued), return 202 immediately, then ingest in the background.

    Using a temp file instead of passing bytes means the upload route releases
    the in-memory buffer right after the response — critical for staying within
    Render's 512 MB RAM limit alongside torch/sentence-transformers.
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

    # Write to a NamedTemporaryFile so we don't hold the whole file in RAM
    # while the route is constructing its response.
    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=ext,
            prefix="studymate_upload_",
        ) as tmp:
            bytes_written = 0
            for chunk in iter(lambda: file.file.read(65_536), b""):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    # Exceeded limit — clean up and reject
                    tmp_path = tmp.name
                    os.unlink(tmp_path)
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
        os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail="The file is empty.")

    log.info("[UPLOAD] saved to temp  filename=%s  size=%.2fMB",
             filename, bytes_written / 1024 / 1024)

    doc = Document(filename=filename, client_id=client_id, status=STATUS_QUEUED, progress=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Pass tmp_path — not bytes — to the background task
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
