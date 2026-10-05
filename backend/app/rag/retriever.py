"""Retrieval: find the chunks most similar to a question — scoped to one client.

client_id is ALWAYS applied to every Qdrant search.
doc_id is optional and further narrows results to a single document.
Both filters use must conditions so there is no fallback to a global search.
"""
from typing import Any, Optional

from langchain_core.documents import Document

from app.config import settings
from app.rag.ingest import client_filter, ensure_collection, get_client, get_store


def retrieve(
    query: str,
    client_id: str,
    k: Optional[int] = None,
    doc_id: Optional[str] = None,
) -> list[Document]:
    """Return top-k chunks that match the query, restricted to client_id.

    Args:
        query:     The user's question.
        client_id: Browser identity — REQUIRED for isolation.
        k:         Number of results (defaults to settings.TOP_K).
        doc_id:    Optional — restrict to a single document.
    """
    f = client_filter(client_id, doc_id)
    return get_store().similarity_search(query, k=k or settings.TOP_K, filter=f)


def get_document_chunks(
    doc_id: str,
    client_id: str,
    limit: int = 2000,
) -> list[Document]:
    """All chunks of one document in reading order — scoped to client."""
    ensure_collection()
    client = get_client()
    f = client_filter(client_id, doc_id)
    points, offset = [], None
    while True:
        batch, offset = client.scroll(
            collection_name=settings.QDRANT_COLLECTION,
            scroll_filter=f,
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
            Document(
                page_content=payload.get("page_content", ""),
                metadata=payload.get("metadata", {}),
            )
        )
    docs.sort(key=lambda d: (d.metadata.get("page", 0), d.metadata.get("chunk", 0)))
    return docs


def format_context(docs: list[Document]) -> str:
    return "\n\n".join(
        f"[{d.metadata.get('source', 'unknown')} p.{d.metadata.get('page', '?')}] {d.page_content}"
        for d in docs
    )


def docs_to_sources(docs: list[Document]) -> list[dict[str, Any]]:
    sources, seen = [], set()
    for d in docs:
        key = (d.metadata.get("source"), d.metadata.get("page"), d.metadata.get("chunk"))
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "type":    "document",
            "file":    d.metadata.get("source", "unknown"),
            "page":    d.metadata.get("page"),
            "snippet": d.page_content[:200],
        })
    return sources
