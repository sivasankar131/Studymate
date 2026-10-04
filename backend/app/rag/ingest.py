"""Ingestion: extract text -> chunk -> embed -> store in Qdrant."""
import io
import logging
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

TXT_PAGE_CHARS = 3000  # plain-text files have no pages, so every ~3000 chars counts as one
BATCH_SIZE = 32  # chunks embedded per request
DOC_ID_KEY = "metadata.doc_id"  # langchain-qdrant stores metadata under "metadata"


@lru_cache
def get_embeddings() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=settings.EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


@lru_cache
def get_client() -> QdrantClient:
    return QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY, timeout=60)


_collection_ready = False


def ensure_collection() -> None:
    """Create the Qdrant collection (and the doc_id index) once."""
    global _collection_ready
    if _collection_ready:
        return
    client = get_client()
    name = settings.QDRANT_COLLECTION
    if not client.collection_exists(name):
        # Probe the model for its vector size instead of hard-coding it.
        dim = len(get_embeddings().embed_query("dimension probe"))
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
        log.info("Created Qdrant collection %s (dim=%d)", name, dim)
    try:
        client.create_payload_index(
            collection_name=name, field_name=DOC_ID_KEY, field_schema=PayloadSchemaType.KEYWORD
        )
    except Exception:  # index may already exist
        log.debug("Payload index not created (probably exists already)", exc_info=True)
    _collection_ready = True


def get_store() -> QdrantVectorStore:
    ensure_collection()
    return QdrantVectorStore(
        client=get_client(),
        collection_name=settings.QDRANT_COLLECTION,
        embedding=get_embeddings(),
    )


def doc_filter(doc_id: Optional[str]) -> Optional[Filter]:
    """Qdrant filter restricting a search to one document (None = search everything)."""
    if not doc_id:
        return None
    return Filter(must=[FieldCondition(key=DOC_ID_KEY, match=MatchValue(value=doc_id))])


def extract_pages(data: bytes, filename: str) -> list[tuple[int, str]]:
    """Return [(page_number, text), ...] for a PDF or TXT file."""
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ValueError("This PDF is password-protected.")
            return [(i, page.extract_text() or "") for i, page in enumerate(reader.pages, start=1)]
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Could not read this PDF. The file may be corrupted.") from exc
    if name.endswith(".txt"):
        text = data.decode("utf-8", errors="ignore")
        return [
            (i + 1, text[start : start + TXT_PAGE_CHARS])
            for i, start in enumerate(range(0, len(text), TXT_PAGE_CHARS))
        ]
    raise ValueError("Unsupported file type. Upload a PDF or TXT file.")


def ingest_file(data: bytes, filename: str, doc_id: str) -> tuple[int, int]:
    """Extract, chunk, embed and store one file. Returns (num_pages, num_chunks)."""
    pages = extract_pages(data, filename)
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.CHUNK_SIZE, chunk_overlap=settings.CHUNK_OVERLAP
    )

    chunks: list[Document] = []
    for page_no, text in pages:
        for piece in splitter.split_text(text):
            if not piece.strip():
                continue
            chunks.append(
                Document(
                    page_content=piece,
                    metadata={
                        "doc_id": doc_id,
                        "source": filename,
                        "page": page_no,
                        "chunk": len(chunks),  # keeps reading order for summaries
                    },
                )
            )

    if not chunks:
        raise ValueError(
            "No readable text found. Scanned or image-only PDFs need OCR, which this app does not do."
        )

    store = get_store()
    for i in range(0, len(chunks), BATCH_SIZE):
        store.add_documents(chunks[i : i + BATCH_SIZE])
    log.info("Ingested %s: %d pages, %d chunks", filename, len(pages), len(chunks))
    return len(pages), len(chunks)


def delete_document_vectors(doc_id: str) -> None:
    """Remove every vector that belongs to a document."""
    ensure_collection()
    get_client().delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=FilterSelector(filter=doc_filter(doc_id)),
    )
