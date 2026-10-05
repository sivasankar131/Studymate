"""Document upload and management endpoints — with browser-level isolation.

Every document is owned by a client_id extracted from the X-Client-ID header.
No document is visible to, or deletable by, a different client.
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
from app.dependencies import get_client_id
from app.rag.ingest import delete_document_vectors

log = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt"}


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
    """Runs in a background thread. Opens its own DB session."""
    t_total = time.perf_counter()
    log.info("[INGEST] start  doc_id=%s  client=%s  filename=%s  size=%.2fKB",
             doc_id, client_id[:8], filename, len(data) / 1024)

    def _set(db: Session, **kwargs) -> None:
        kwargs["updated_at"] = datetime.now(timezone.utc)
        db.query(Document).filter(Document.id == doc_id).update(kwargs)
        db.commit()

    db = SessionLocal()
    try:
        # Stage 1 — extraction
        _set(db, status="processing", progress=10)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import extract_pages
            pages = extract_pages(data, filename)
        except ValueError as exc:
            log.warning("[INGEST] extraction failed  doc_id=%s  reason=%s", doc_id, exc)
            _set(db, status="failed", progress=0, error_message=str(exc))
            return
        log.info("[INGEST] extraction  pages=%d  %.2fs", len(pages), time.perf_counter() - t0)

        # Stage 2 — chunking
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
                                "client_id": client_id,   # ← isolation key
                                "doc_id":    doc_id,
                                "source":    filename,
                                "page":      page_no,
                                "chunk":     len(chunks),
                            },
                        ))
        except Exception:
            log.exception("[INGEST] chunking failed  doc_id=%s", doc_id)
            _set(db, status="failed", progress=0,
                 error_message="Text chunking failed. Please try again.")
            return
        if not chunks:
            _set(db, status="failed", progress=0,
                 error_message=(
                     "No readable text found. "
                     "Scanned or image-only PDFs need OCR, which is not supported."
                 ))
            return
        log.info("[INGEST] chunking  chunks=%d  %.2fs", len(chunks), time.perf_counter() - t0)

        # Stage 3 — embedding + Qdrant insertion
        _set(db, status="indexing", progress=55)
        t0 = time.perf_counter()
        try:
            from app.rag.ingest import get_store, BATCH_SIZE
            store = get_store()
            for i in range(0, len(chunks), BATCH_SIZE):
                store.add_documents(chunks[i: i + BATCH_SIZE])
                pct = 55 + int(((i + BATCH_SIZE) / len(chunks)) * 40)
                _set(db, status="indexing", progress=min(pct, 95))
        except Exception:
            log.exception("[INGEST] Qdrant insertion failed  doc_id=%s", doc_id)
            try:
                delete_document_vectors(doc_id, client_id)
            except Exception:
                pass
            _set(db, status="failed", progress=0,
                 error_message="Document indexing failed. Please try again.")
            return
        log.info("[INGEST] embedding+insertion  %.2fs", time.perf_counter() - t0)

        # Done
        db.query(Document).filter(Document.id == doc_id).update({
            "status":     "ready",
            "progress":   100,
            "num_pages":  len(pages),
            "num_chunks": len(chunks),
            "updated_at": datetime.now(timezone.utc),
        })
        db.commit()
        log.info("[INGEST] complete  doc_id=%s  pages=%d  chunks=%d  total=%.2fs",
                 doc_id, len(pages), len(chunks), time.perf_counter() - t_total)

    except Exception:
        log.exception("[INGEST] unexpected error  doc_id=%s", doc_id)
        try:
            _set(db, status="failed", progress=0,
                 error_message="Unexpected error during processing.")
        except Exception:
            pass
    finally:
        db.close()


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DocumentOut, status_code=202)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Accept a file, create a 'queued' document record owned by client_id,
    return 202 immediately, then ingest in the background."""
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

    doc = Document(filename=filename, client_id=client_id, status="queued", progress=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Pass client_id explicitly into the background task so it's captured
    # in the thread's closure — never read from a shared global.
    background_tasks.add_task(_run_ingestion, doc.id, client_id, data, filename)
    log.info("[UPLOAD] queued  doc_id=%s  client=%s", doc.id, client_id[:8])
    return doc


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Return ONLY documents owned by the requesting client."""
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
    """Polling endpoint — verifies ownership before returning status."""
    doc = db.get(Document, doc_id)
    if doc is None or doc.client_id != client_id:
        # Return 404 for both "not found" and "wrong owner" —
        # never reveal that another client's document exists.
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Delete a document only if it is owned by the requesting client."""
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
