"""Document upload and management endpoints — with browser-level isolation.

GIL isolation design
--------------------
Python's GIL means a CPU-bound background thread (embedding generation) can
starve the asyncio event loop — exactly like Node.js event-loop blocking.
The fix: run the heavy CPU work (_run_ingestion_subprocess) in a subprocess
via concurrent.futures.ProcessPoolExecutor, which runs in a separate Python
process with its own GIL and therefore cannot block the main uvicorn worker.

Upload flow
-----------
1. Route receives file, validates it, streams it to a NamedTemporaryFile.
2. Creates Document record (status=queued), returns 202 immediately.
3. Schedules _launch_ingestion_subprocess() as a FastAPI BackgroundTask.
4. BackgroundTask submits the CPU work to the ProcessPoolExecutor in a
   non-blocking way, then returns so the event loop stays free.
5. A separate OS process runs _run_ingestion_subprocess() — torch/embedding
   CPU work never touches the main process's GIL.
6. On completion/failure the subprocess writes the final status to Postgres
   via a fresh SQLAlchemy session.

Safety guarantees
-----------------
* Hard deadline via threading.Timer fires in the main process — marks failed
  in DB even if the subprocess hangs.
* Every stage wrapped in try/except — always reaches a terminal state.
* Temp file cleaned up in all code paths.
* ProcessPoolExecutor is module-level (singleton) — one pool, max 1 worker,
  so uploads are serialised and RAM isn't exhausted by concurrent jobs.
"""
import concurrent.futures
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

# ── Process pool for CPU-bound embedding work ─────────────────────────────────
# max_workers=1 serialises uploads so RAM stays bounded on Render free tier.
# Each submitted job runs in a separate Python process with its own GIL —
# the main uvicorn process (serving /health, /chat, /documents) is never
# blocked by torch/sentence-transformers CPU work.
_POOL = concurrent.futures.ProcessPoolExecutor(max_workers=1)


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


# ─── Subprocess ingestion function (runs in separate process) ─────────────────

def _run_ingestion_subprocess(
    doc_id: str,
    client_id: str,
    tmp_path: str,
    filename: str,
    qdrant_url: str,
    qdrant_api_key: str,
    qdrant_collection: str,
    embedding_model: str,
    chunk_size: int,
    chunk_overlap: int,
) -> tuple[int, int]:
    """
    Runs in a SEPARATE PROCESS via ProcessPoolExecutor.

    All configuration is passed explicitly (no shared state with parent).
    Returns (num_pages, num_chunks) on success; raises on failure.
    The caller (_launch_ingestion_subprocess) handles DB status updates.
    """
    import io
    import time as _time
    import logging as _logging
    from pypdf import PdfReader
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_core.documents import Document as LCDoc

    _log = _logging.getLogger("studymate.subprocess")
    _logging.basicConfig(level=_logging.INFO,
                         format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    t_total = _time.perf_counter()
    _log.info("[SUB] start  doc_id=%s  filename=%s", doc_id[:8], filename)

    # ── Read temp file ────────────────────────────────────────────────────────
    with open(tmp_path, "rb") as fh:
        data = fh.read()

    # ── Extract pages ─────────────────────────────────────────────────────────
    name = filename.lower()
    if name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("This PDF is password-protected and cannot be read.")
        pages = [(i, page.extract_text() or "") for i, page in enumerate(reader.pages, start=1)]
        if sum(len(t) for _, t in pages) < 50:
            raise ValueError(
                "No readable text found. This appears to be a scanned or image-only PDF. "
                "OCR is not supported."
            )
    elif name.endswith(".txt"):
        TXT_PAGE_CHARS = 3000
        text = data.decode("utf-8", errors="ignore")
        if not text.strip():
            raise ValueError("The TXT file is empty.")
        pages = [
            (i + 1, text[start: start + TXT_PAGE_CHARS])
            for i, start in enumerate(range(0, len(text), TXT_PAGE_CHARS))
        ]
    else:
        raise ValueError("Unsupported file type.")
    del data

    num_pages = len(pages)
    _log.info("[SUB] extraction  pages=%d  elapsed=%.2fs",
              num_pages, _time.perf_counter() - t_total)

    # ── Chunk ─────────────────────────────────────────────────────────────────
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )
    chunks: list[LCDoc] = []
    for page_no, text_content in pages:
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
    del pages
    if not chunks:
        raise ValueError(
            "No readable text found. Scanned or image-only PDFs need OCR, "
            "which is not supported."
        )
    _log.info("[SUB] chunking  chunks=%d", len(chunks))

    # ── Embed + insert ────────────────────────────────────────────────────────
    # Import torch/sentence-transformers here — in the subprocess, not the
    # main process, so the main uvicorn worker's GIL is never touched.
    from langchain_huggingface import HuggingFaceEmbeddings
    from langchain_qdrant import QdrantVectorStore
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams

    t0 = _time.perf_counter()
    emb = HuggingFaceEmbeddings(
        model_name=embedding_model,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
    _log.info("[SUB] model loaded  elapsed=%.2fs", _time.perf_counter() - t0)

    qclient = QdrantClient(url=qdrant_url, api_key=qdrant_api_key, timeout=60)
    if not qclient.collection_exists(qdrant_collection):
        qclient.create_collection(
            collection_name=qdrant_collection,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE),
        )

    store = QdrantVectorStore(
        client=qclient,
        collection_name=qdrant_collection,
        embedding=emb,
    )

    BATCH = 32
    t0 = _time.perf_counter()
    for i in range(0, len(chunks), BATCH):
        store.add_documents(chunks[i: i + BATCH])
    _log.info("[SUB] embedding+insertion  elapsed=%.2fs  total=%.2fs",
              _time.perf_counter() - t0, _time.perf_counter() - t_total)

    return num_pages, len(chunks)


# ─── Main-process launcher (runs as FastAPI BackgroundTask) ───────────────────

def _launch_ingestion_subprocess(
    doc_id: str,
    client_id: str,
    tmp_path: str,
    filename: str,
) -> None:
    """
    Runs in a background *thread* in the main uvicorn process.
    Submits the CPU-heavy work to the ProcessPoolExecutor subprocess,
    then blocks THIS THREAD (not the event loop — this is a sync thread)
    waiting for the result.  The asyncio event loop continues serving
    requests unimpeded because the GIL work is in a different OS process.
    """
    timeout_secs   = settings.INDEXING_TIMEOUT_SECONDS
    deadline_fired = threading.Event()
    future: concurrent.futures.Future | None = None

    # ── Deadline timer ────────────────────────────────────────────────────────
    def _fire_deadline() -> None:
        deadline_fired.set()
        log.error("[INGEST] TIMEOUT  doc_id=%s  limit=%ds — cancelling and marking failed",
                  doc_id, timeout_secs)
        if future is not None:
            future.cancel()
        _mark_failed(doc_id, f"Indexing timed out after {timeout_secs}s. Please try uploading again.")

    timer = threading.Timer(timeout_secs, _fire_deadline)
    timer.daemon = True
    timer.start()

    try:
        _mark_status(doc_id, STATUS_PROCESSING, 5)

        future = _POOL.submit(
            _run_ingestion_subprocess,
            doc_id, client_id, tmp_path, filename,
            settings.QDRANT_URL,
            settings.QDRANT_API_KEY,
            settings.QDRANT_COLLECTION,
            settings.EMBEDDING_MODEL,
            settings.CHUNK_SIZE,
            settings.CHUNK_OVERLAP,
        )

        # Update progress while waiting
        _mark_status(doc_id, STATUS_PROCESSING, 20)

        # Block this thread waiting — event loop is NOT blocked (different thread)
        num_pages, num_chunks = future.result(timeout=timeout_secs + 10)

        if deadline_fired.is_set():
            return

        # ── Success ───────────────────────────────────────────────────────────
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
            log.info("[INGEST] complete  doc_id=%s  pages=%d  chunks=%d",
                     doc_id, num_pages, num_chunks)
        finally:
            _db.close()

    except concurrent.futures.CancelledError:
        log.warning("[INGEST] future cancelled  doc_id=%s", doc_id)
        # Deadline handler already wrote the failed status
    except concurrent.futures.TimeoutError:
        log.error("[INGEST] future timed out  doc_id=%s", doc_id)
        _mark_failed(doc_id, f"Indexing timed out after {timeout_secs}s. Please try uploading again.")
    except Exception as exc:
        if deadline_fired.is_set():
            return
        log.exception("[INGEST] subprocess failed  doc_id=%s", doc_id)
        msg = str(exc)
        # Don't expose internal details — check for known user-facing errors
        if "password-protected" in msg or "No readable text" in msg or "empty" in msg.lower():
            user_msg = msg
        else:
            user_msg = "Document indexing failed. Please try uploading again."
        _mark_failed(doc_id, user_msg)
    finally:
        timer.cancel()
        try:
            os.unlink(tmp_path)
        except OSError:
            log.warning("[INGEST] could not delete temp file  path=%s", tmp_path)


def _mark_status(doc_id: str, status: str, progress: int) -> None:
    db = SessionLocal()
    try:
        db.query(Document).filter(Document.id == doc_id).update({
            "status":     status,
            "progress":   progress,
            "updated_at": datetime.now(timezone.utc),
        })
        db.commit()
    except Exception:
        log.exception("[INGEST] could not update status  doc_id=%s", doc_id)
    finally:
        db.close()


def _mark_failed(doc_id: str, message: str) -> None:
    db = SessionLocal()
    try:
        db.query(Document).filter(Document.id == doc_id).update({
            "status":        STATUS_FAILED,
            "progress":      0,
            "error_message": message,
            "updated_at":    datetime.now(timezone.utc),
        })
        db.commit()
    except Exception:
        log.exception("[INGEST] could not write failure status  doc_id=%s", doc_id)
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
    """
    Accept file → validate → stream to temp file → create DB record → return 202.
    Heavy embedding work runs in a subprocess pool — the main process GIL is
    never held by torch, so /health, /chat, /documents stay responsive.
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

    log.info("[UPLOAD] saved  filename=%s  size=%.2fMB", filename, bytes_written / 1024 / 1024)

    doc = Document(filename=filename, client_id=client_id, status=STATUS_QUEUED, progress=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(_launch_ingestion_subprocess, doc.id, client_id, tmp_path, filename)
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
