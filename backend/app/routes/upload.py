"""Document upload and management endpoints."""
import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import get_db
from app.db.models import Document
from app.rag.ingest import delete_document_vectors, ingest_file

log = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt"}


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    num_pages: int
    num_chunks: int
    created_at: datetime


@router.post("/upload", response_model=DocumentOut, status_code=201)
def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a PDF or TXT file: extract, chunk, embed and store it."""
    filename = os.path.basename(file.filename or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported.")

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.MAX_UPLOAD_MB} MB.")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")

    doc = Document(filename=filename)
    db.add(doc)
    db.flush()  # assigns doc.id

    try:
        num_pages, num_chunks = ingest_file(data, filename, doc.id)
    except ValueError as exc:  # unreadable / empty / unsupported content
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Ingestion failed for %s", filename)
        db.rollback()
        try:
            delete_document_vectors(doc.id)  # drop any partially stored chunks
        except Exception:
            log.warning("Cleanup of partial vectors failed", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail="Could not process the document. The AI or vector service may be unavailable "
            "or rate-limited. Please try again in a minute.",
        ) from exc

    doc.num_pages = num_pages
    doc.num_chunks = num_chunks
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)):
    return db.query(Document).order_by(Document.created_at.desc()).all()


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        delete_document_vectors(doc_id)
    except Exception as exc:
        log.exception("Could not delete vectors for %s", doc_id)
        raise HTTPException(status_code=502, detail="Could not reach the vector store.") from exc
    db.delete(doc)
    db.commit()
    return Response(status_code=204)
