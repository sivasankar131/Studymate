"""Ingestion: extract text → chunk → embed → store in Qdrant.

Embedding backend: fastembed (ONNX Runtime)
--------------------------------------------
Previous implementation used torch + sentence-transformers (~400 MB RAM,
blocks Python GIL during inference).  This caused:
  - OOM kills on Render's 512 MB free tier
  - Event-loop stalls because torch holds the GIL during matrix ops

fastembed uses ONNX Runtime which:
  - loads in ~100 MB (bge-small-en-v1.5 ONNX model is ~23 MB)
  - releases the GIL during inference (ONNX C++ runtime)
  - produces identical 384-dim vectors for the same model
  - requires NO torch, NO CUDA, NO GPU

langchain-qdrant has native FastEmbedEmbeddings support so the
retrieval path (similarity_search) works without any extra changes.

Singleton design:
  - get_embeddings() — @lru_cache, lazy, loaded once per process
  - get_client()     — @lru_cache, one Qdrant connection per process
  - ensure_collection() — idempotent, safe to call at startup (no model load)
"""
import io
import logging
import time
from functools import lru_cache
from typing import Optional

from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PayloadSchemaType,
    VectorParams,
)

from app.config import settings

log = logging.getLogger(__name__)

TXT_PAGE_CHARS = 3000
BATCH_SIZE     = 32
BGE_SMALL_DIM  = 384   # BAAI/bge-small-en-v1.5 — same dim for ONNX and torch

CLIENT_ID_KEY = "metadata.client_id"
DOC_ID_KEY    = "metadata.doc_id"


# ─── Cached singletons ───────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embeddings():
    """
    Load the fastembed ONNX model once per process — lazily on first use.

    The model is pre-downloaded at build time (see render.yaml buildCommand)
    so no network download happens during request processing.
    Falls back with a clear error if fastembed is not installed.
    """
    try:
        from fastembed import TextEmbedding  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            "fastembed is not installed. Run: pip install fastembed>=0.3.1"
        ) from exc

    from langchain_core.embeddings import Embeddings

    log.info("[EMBED] loading fastembed model %s …", settings.EMBEDDING_MODEL)
    t0 = time.perf_counter()

    # Use a fixed cache directory so the pre-downloaded model is found
    # reliably.  FASTEMBED_CACHE_PATH env var overrides this if set.
    import os as _os
    cache_path = _os.environ.get(
        "FASTEMBED_CACHE_PATH",
        _os.path.join(_os.path.expanduser("~"), ".cache", "fastembed"),
    )
    _model = TextEmbedding(model_name=settings.EMBEDDING_MODEL, cache_dir=cache_path)
    log.info("[EMBED] model loaded in %.2fs", time.perf_counter() - t0)

    class _FastEmbedWrapper(Embeddings):
        """Thin LangChain-compatible wrapper around fastembed.TextEmbedding."""

        def embed_documents(self, texts: list[str]) -> list[list[float]]:
            return [v.tolist() for v in _model.embed(texts)]

        def embed_query(self, text: str) -> list[float]:
            return next(_model.embed([text])).tolist()

    return _FastEmbedWrapper()


@lru_cache(maxsize=1)
def get_client() -> QdrantClient:
    return QdrantClient(
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY,
        timeout=60,
    )


# ─── Collection bootstrap ────────────────────────────────────────────────────

_collection_ready = False


def ensure_collection() -> None:
    """Create collection + payload indexes if they don't exist.
    Safe to call at startup — never calls get_embeddings().
    """
    global _collection_ready
    if _collection_ready:
        return
    client = get_client()
    name   = settings.QDRANT_COLLECTION

    if not client.collection_exists(name):
        log.info("[QDRANT] creating collection '%s' dim=%d", name, BGE_SMALL_DIM)
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=BGE_SMALL_DIM, distance=Distance.COSINE),
        )

    for field in (CLIENT_ID_KEY, DOC_ID_KEY):
        try:
            client.create_payload_index(
                collection_name=name,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
            )
        except Exception:
            log.debug("[QDRANT] payload index for '%s' already exists", field, exc_info=False)

    _collection_ready = True


def get_store() -> QdrantVectorStore:
    ensure_collection()
    return QdrantVectorStore(
        client=get_client(),
        collection_name=settings.QDRANT_COLLECTION,
        embedding=get_embeddings(),
    )


# ─── Filter builders ─────────────────────────────────────────────────────────

def client_filter(client_id: str, doc_id: Optional[str] = None) -> Filter:
    conditions = [
        FieldCondition(key=CLIENT_ID_KEY, match=MatchValue(value=client_id))
    ]
    if doc_id:
        conditions.append(
            FieldCondition(key=DOC_ID_KEY, match=MatchValue(value=doc_id))
        )
    return Filter(must=conditions)


# ─── Text extraction ─────────────────────────────────────────────────────────

def extract_pages(data: bytes, filename: str) -> list[tuple[int, str]]:
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ValueError("This PDF is password-protected and cannot be read.")
            pages = [(i, page.extract_text() or "") for i, page in enumerate(reader.pages, start=1)]
            if sum(len(t) for _, t in pages) < 50:
                raise ValueError(
                    "No readable text found. This appears to be a scanned or image-only PDF. "
                    "OCR is not supported."
                )
            return pages
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Could not read this PDF. The file may be corrupted.") from exc

    if name.endswith(".txt"):
        text = data.decode("utf-8", errors="ignore")
        if not text.strip():
            raise ValueError("The TXT file is empty.")
        return [
            (i + 1, text[start: start + TXT_PAGE_CHARS])
            for i, start in enumerate(range(0, len(text), TXT_PAGE_CHARS))
        ]

    raise ValueError("Unsupported file type. Please upload a PDF or TXT file.")


# ─── Ingestion (used by upload route background thread) ──────────────────────

def ingest_file(data: bytes, filename: str, doc_id: str, client_id: str) -> tuple[int, int]:
    """Extract, chunk, embed and store one file. Returns (num_pages, num_chunks)."""
    t_total = time.perf_counter()
    log.info("[INGEST] start  filename=%s  client=%s  size=%.2fKB",
             filename, client_id[:8], len(data) / 1024)

    t0 = time.perf_counter()
    pages = extract_pages(data, filename)
    log.info("[INGEST] extraction  pages=%d  %.2fs", len(pages), time.perf_counter() - t0)

    t0 = time.perf_counter()
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.CHUNK_SIZE, chunk_overlap=settings.CHUNK_OVERLAP
    )
    chunks: list[Document] = []
    for page_no, text in pages:
        for piece in splitter.split_text(text):
            if piece.strip():
                chunks.append(Document(
                    page_content=piece,
                    metadata={
                        "client_id": client_id,
                        "doc_id":    doc_id,
                        "source":    filename,
                        "page":      page_no,
                        "chunk":     len(chunks),
                    },
                ))
    log.info("[INGEST] chunking  chunks=%d  %.2fs", len(chunks), time.perf_counter() - t0)

    if not chunks:
        raise ValueError("No readable text found. Scanned or image-only PDFs need OCR.")

    t0 = time.perf_counter()
    store = get_store()
    for i in range(0, len(chunks), BATCH_SIZE):
        store.add_documents(chunks[i: i + BATCH_SIZE])
    log.info("[INGEST] embedding+insertion  %.2fs", time.perf_counter() - t0)
    log.info("[INGEST] complete  filename=%s  pages=%d  chunks=%d  total=%.2fs",
             filename, len(pages), len(chunks), time.perf_counter() - t_total)

    return len(pages), len(chunks)


def delete_document_vectors(doc_id: str, client_id: str) -> None:
    ensure_collection()
    get_client().delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=FilterSelector(filter=client_filter(client_id, doc_id)),
    )
