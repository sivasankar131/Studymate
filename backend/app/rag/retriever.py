"""Retrieval: find the chunks most similar to a question, and format them for the LLM."""
from typing import Any, Optional

from langchain_core.documents import Document

from app.config import settings
from app.rag.ingest import doc_filter, ensure_collection, get_client, get_store


def retrieve(query: str, k: Optional[int] = None, doc_id: Optional[str] = None) -> list[Document]:
    """Top-k similar chunks, optionally restricted to a single document."""
    return get_store().similarity_search(query, k=k or settings.TOP_K, filter=doc_filter(doc_id))


def get_document_chunks(doc_id: str, limit: int = 2000) -> list[Document]:
    """All chunks of one document in reading order (used for summaries)."""
    ensure_collection()
    client = get_client()
    points, offset = [], None
    while True:
        batch, offset = client.scroll(
            collection_name=settings.QDRANT_COLLECTION,
            scroll_filter=doc_filter(doc_id),
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        points.extend(batch)
        if offset is None or len(points) >= limit:
            break

    docs = []
    for p in points:
        payload = p.payload or {}
        docs.append(
            Document(page_content=payload.get("page_content", ""), metadata=payload.get("metadata", {}))
        )
    docs.sort(key=lambda d: (d.metadata.get("page", 0), d.metadata.get("chunk", 0)))
    return docs


def format_context(docs: list[Document]) -> str:
    """Render chunks as '[file p.N] text' blocks so the LLM can cite them."""
    return "\n\n".join(
        f"[{d.metadata.get('source', 'unknown')} p.{d.metadata.get('page', '?')}] {d.page_content}"
        for d in docs
    )


def docs_to_sources(docs: list[Document]) -> list[dict[str, Any]]:
    """Source entries (file, page, snippet) returned to the frontend."""
    sources, seen = [], set()
    for d in docs:
        key = (d.metadata.get("source"), d.metadata.get("page"), d.metadata.get("chunk"))
        if key in seen:
            continue
        seen.add(key)
        sources.append(
            {
                "type": "document",
                "file": d.metadata.get("source", "unknown"),
                "page": d.metadata.get("page"),
                "snippet": d.page_content[:200],
            }
        )
    return sources
