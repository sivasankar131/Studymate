"""Ingestion: extract text → chunk → embed → store in Qdrant.

All heavy work (embedding model load, Qdrant client) is cached with @lru_cache
so it happens only once per worker process, not once per document.
"""
import io
import logging
import time
from functools import lru_cache
from typing import Optional

from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
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

TXT_PAGE_CHARS = 3000   # plain-text has no pages; every ~3000 chars = 1 "page"
BATCH_SIZE = 32          # chunks embedded per Qdrant add_documents call
DOC_ID_KEY = "metadata.doc_id"


# ─── Cached singletons ───────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embeddings() -> HuggingFaceEmbeddings:
    """Load the embedding model once and reuse it for every document."""
    log.info("[EMBED] loading model %s …", settings.EMBEDDING_MODEL)
    t0 = time.perf_counter()
    emb = HuggingFaceEmbeddings(
        model_name=settings.EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
    log.info("[EMBED] model loaded in %.2fs", time.perf_counter() - t0)
    return emb


@lru_cache(maxsize=1)
def get_client() -> QdrantClient:
    """Create the Qdrant client once and reuse it."""
    return QdrantClient(
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY,
        timeout=60,
    )


# ─── Collection bootstrap ────────────────────────────────────────────────────

_collection_ready = False


def ensure_collection() -> None:
    """Create the Qdrant collection and doc_id index once per process."""
    global _collection_ready
    if _collection_ready:
        return
    client = get_client()
    name = settings.QDRANT_COLLECTION
    if not client.collection_exists(name):
        dim = len(get_embeddings().embed_query("dimension probe"))
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
        log.info("[QDRANT] created collection %s  dim=%d", name, dim)
    try:
        client.create_payload_index(
            collection_name=name,
            field_name=DOC_ID_KEY,
            field_schema=PayloadSchemaType.KEYWORD,
        )
    except Exception:
        log.debug("[QDRANT] payload index already exists (ok)", exc_info=True)
    _collection_ready = True


def get_store() -> QdrantVectorStore:
    ensure_collection()
    return QdrantVectorStore(
        client=get_client(),
        collection_name=settings.QDRANT_COLLECTION,
        embedding=get_embeddings(),
    )


# ─── Helpers ─────────────────────────────────────────────────────────────────

def doc_filter(doc_id: Optional[str]) -> Optional[Filter]:
    if not doc_id:
        return None
    return Filter(must=[FieldCondition(key=DOC_ID_KEY, match=MatchValue(value=doc_id))])


# ─── Text extraction ─────────────────────────────────────────────────────────

def extract_pages(data: bytes, filename: str) -> list[tuple[int, str]]:
    """Return [(page_number, text), ...] for a PDF or TXT file."""
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ValueError("This PDF is password-protected and cannot be read.")
            pages = [(i, page.extract_text() or "") for i, page in enumerate(reader.pages, start=1)]
            total_text = sum(len(t) for _, t in pages)
            if total_text < 50:
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


# ─── Full ingestion (used by tests / direct calls; upload route uses stages) ──

def ingest_file(data: bytes, filename: str, doc_id: str) -> tuple[int, int]:
    """Extract, chunk, embed and store one file. Returns (num_pages, num_chunks)."""
    t_total = time.perf_counter()
    log.info("[INGEST] start  filename=%s  size=%.2fKB", filename, len(data) / 1024)

    # Extraction
    t0 = time.perf_counter()
    pages = extract_pages(data, filename)
    log.info("[INGEST] extraction  pages=%d  elapsed=%.2fs", len(pages), time.perf_counter() - t0)

    # Chunking
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
                        "doc_id": doc_id,
                        "source": filename,
                        "page": page_no,
                        "chunk": len(chunks),
                    },
                ))
    log.info("[INGEST] chunking  chunks=%d  elapsed=%.2fs", len(chunks), time.perf_counter() - t0)

    if not chunks:
        raise ValueError(
            "No readable text found. Scanned or image-only PDFs need OCR, which is not supported."
        )

    # Embedding + insertion
    t0 = time.perf_counter()
    store = get_store()
    for i in range(0, len(chunks), BATCH_SIZE):
        store.add_documents(chunks[i: i + BATCH_SIZE])
    log.info("[INGEST] embedding+insertion  elapsed=%.2fs", time.perf_counter() - t0)
    log.info("[INGEST] complete  filename=%s  pages=%d  chunks=%d  total=%.2fs",
             filename, len(pages), len(chunks), time.perf_counter() - t_total)

    return len(pages), len(chunks)


def delete_document_vectors(doc_id: str) -> None:
    """Remove every vector belonging to a document."""
    ensure_collection()
    get_client().delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=FilterSelector(filter=doc_filter(doc_id)),
    )
