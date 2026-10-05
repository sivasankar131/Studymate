"""Document upload and management endpoints.

Upload flow:
  1. POST /upload  – validates file, inserts a Document row with status='queued',
                     kicks off background ingestion, returns immediately (~50ms).
  2. Background   – runs PDF extraction → chunking → embedding → Qdrant insertion,
                     updating status/progress at each stage.
  3. GET /documents/{id}/status  – frontend polls this until status in {ready, failed}.
"""
import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal, get_db
from app.db.models import Document
from app.rag.ingest import delete_document_vectors, ingest_file

log = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt"}


# ─── Pydantic schemas ────────────────────────────────────────────────────────

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


# ─── Background ingestion task ───────────────────────────────────────────────

def _run_ingestion(doc_id: str, data: bytes, filename: str) -> None:
    """
    Runs entirely in a background thread (FastAPI BackgroundTasks).
    Opens its own DB session so it doesn't share the request session.
    Updates document status at each stage so the frontend can poll progress.
    """
    t_total = time.perf_counter()
    log.info("[INGEST] start  doc_id=%s  filename=%s  size=%.2fKB",
             doc_id, filename, len(data) / 1024)

    def _set(db: Session, **kwargs) -> None:
        kwargs["updated_at"] = datetime.now(timezone.utc)
        db.query(Document).filter(Document.id == doc_id).update(kwargs)
        db.commit()

    db = SessionLocal()
    try:
        # ── Stage 1: PDF/TXT extraction ──────────────────────────────────────
        _set(db, status="processing", progress=10)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import extract_pages
            pages = extract_pages(data, filename)
        except ValueError as exc:
            log.warning("[INGEST] extraction failed  doc_id=%s  reason=%s", doc_id, exc)
            _set(db, status="failed", progress=0, error_message=str(exc))
            return
        log.info("[INGEST] extraction done  pages=%d  elapsed=%.2fs",
                 len(pages), time.perf_counter() - t0)

        # ── Stage 2: Chunking ────────────────────────────────────────────────
        _set(db, status="processing", progress=30)
        t0 = time.perf_counter()
        try:
            from langchain_text_splitters import RecursiveCharacterTextSplitter
            from langchain_core.documents import Document as LCDoc
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=settings.CHUNK_SIZE,
                chunk_overlap=settings.CHUNK_OVERLAP,
            )
            chunks: list = []
            for page_no, text in pages:
                for piece in splitter.split_text(text):
                    if piece.strip():
                        chunks.append(LCDoc(
                            page_content=piece,
                            metadata={
                                "doc_id": doc_id,
                                "source": filename,
                                "page": page_no,
                                "chunk": len(chunks),
                            },
                        ))
        except Exception as exc:
            log.exception("[INGEST] chunking failed  doc_id=%s", doc_id)
            _set(db, status="failed", progress=0,
                 error_message="Text chunking failed. Please try again.")
            return
        if not chunks:
            msg = ("No readable text found in this document. "
                   "Scanned or image-only PDFs need OCR, which is not supported.")
            log.warning("[INGEST] no chunks  doc_id=%s", doc_id)
            _set(db, status="failed", progress=0, error_message=msg)
            return
        log.info("[INGEST] chunking done  chunks=%d  elapsed=%.2fs",
                 len(chunks), time.perf_counter() - t0)

        # ── Stage 3: Embedding + Qdrant insertion ────────────────────────────
        _set(db, status="indexing", progress=55)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import get_store, BATCH_SIZE
            store = get_store()
            for i in range(0, len(chunks), BATCH_SIZE):
                store.add_documents(chunks[i: i + BATCH_SIZE])
                pct = 55 + int(((i + BATCH_SIZE) / len(chunks)) * 40)
                _set(db, status="indexing", progress=min(pct, 95))
        except Exception as exc:
            log.exception("[INGEST] Qdrant insertion failed  doc_id=%s", doc_id)
            try:
                delete_document_vectors(doc_id)
            except Exception:
                pass
            _set(db, status="failed", progress=0,
                 error_message="Document indexing failed. Please try again.")
            return
        log.info("[INGEST] embedding+insertion done  elapsed=%.2fs",
                 time.perf_counter() - t0)

        # ── Done ─────────────────────────────────────────────────────────────
        db.query(Document).filter(Document.id == doc_id).update({
            "status": "ready",
            "progress": 100,
            "num_pages": len(pages),
            "num_chunks": len(chunks),
            "updated_at": datetime.now(timezone.utc),
        })
        db.commit()
        log.info("[INGEST] complete  doc_id=%s  pages=%d  chunks=%d  total=%.2fs",
                 doc_id, len(pages), len(chunks), time.perf_counter() - t_total)

    except Exception as exc:
        log.exception("[INGEST] unexpected error  doc_id=%s", doc_id)
        try:
            _set(db, status="failed", progress=0,
                 error_message="Unexpected error during processing.")
        except Exception:
            pass
    finally:
        db.close()


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DocumentOut, status_code=202)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Accept a file, validate it, record it as 'queued', then return immediately.
    Actual ingestion (extraction → chunking → embedding → Qdrant) runs in the
    background so the browser is not blocked.
    """
    filename = os.path.basename(file.filename or "")
    ext = os.path.splitext(filename)[1].lower()

    log.info("[UPLOAD] received  filename=%s", filename)

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

    log.info("[UPLOAD] validated  filename=%s  size=%.2fMB",
             filename, len(data) / 1024 / 1024)

    # Insert document record immediately — status = queued
    doc = Document(filename=filename, status="queued", progress=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Schedule background ingestion — returns to caller instantly
    background_tasks.add_task(_run_ingestion, doc.id, data, filename)

    log.info("[UPLOAD] queued  doc_id=%s", doc.id)
    return doc


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)):
    return db.query(Document).order_by(Document.created_at.desc()).all()


@router.get("/documents/{doc_id}/status", response_model=DocumentStatusOut)
def document_status(doc_id: str, db: Session = Depends(get_db)):
    """Lightweight status endpoint the frontend polls every 1–2 s."""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        delete_document_vectors(doc_id)
    except Exception as exc:
        log.exception("[DELETE] vector deletion failed  doc_id=%s", doc_id)
        raise HTTPException(status_code=502, detail="Could not reach the vector store.") from exc
    db.delete(doc)
    db.commit()
    log.info("[DELETE] done  doc_id=%s  filename=%s", doc_id, doc.filename)
    return Response(status_code=204)
