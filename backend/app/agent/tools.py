"""Agent tools — all retrieval operations are scoped to client_id."""
import logging
from typing import Optional

from langchain_core.tools import tool

from app.db.database import SessionLocal
from app.db.models import Document as DocumentRow
from app.rag.qa import get_llm, message_text
from app.rag.retriever import docs_to_sources, format_context, get_document_chunks, retrieve

log = logging.getLogger(__name__)

MAX_SUMMARY_CHUNKS = 30


def _sample_evenly(items: list, n: int) -> list:
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


def make_tools(client_id: str, selected_doc_id: Optional[str] = None) -> list:
    """Build tool list scoped to client_id (and optionally a single doc)."""

    @tool(response_format="content_and_artifact")
    def search_documents(query: str):
        """Search the user's uploaded documents for relevant passages."""
        docs = retrieve(query, client_id=client_id, doc_id=selected_doc_id)
        if not docs:
            return "No relevant passages found in your uploaded documents.", []
        return format_context(docs), docs_to_sources(docs)

    @tool
    def list_documents() -> str:
        """List uploaded documents for this browser session."""
        with SessionLocal() as db:
            rows = (
                db.query(DocumentRow)
                .filter(DocumentRow.client_id == client_id)
                .order_by(DocumentRow.created_at.desc())
                .all()
            )
        if not rows:
            return "No documents have been uploaded yet."
        return "\n".join(
            f"id={r.id} | {r.filename} | {r.num_pages} pages" for r in rows
        )

    @tool(response_format="content_and_artifact")
    def summarize_document(doc_id: Optional[str] = None):
        """Summarise a whole uploaded document."""
        target = doc_id or selected_doc_id
        if not target:
            return "No document specified. Call list_documents to find a document id.", []
        chunks = get_document_chunks(target, client_id=client_id)
        if not chunks:
            return "That document was not found or contains no text.", []
        filename = chunks[0].metadata.get("source", "the document")
        sample   = _sample_evenly(chunks, MAX_SUMMARY_CHUNKS)
        prompt   = (
            "Summarise the following document in a clear, structured way.\n\n"
            + format_context(sample)
        )
        summary = message_text(get_llm().invoke(prompt).content)
        source  = {"type": "document", "file": filename, "page": None,
                   "snippet": "Whole-document summary"}
        return summary, [source]

    @tool(response_format="content_and_artifact")
    def generate_quiz(topic: str, num_questions: int = 5):
        """Create multiple-choice questions on a topic from uploaded documents."""
        n    = max(1, min(num_questions, 15))
        docs = retrieve(topic, client_id=client_id, k=8, doc_id=selected_doc_id)
        if not docs:
            return "No material found on that topic.", []
        prompt = (
            f'Write {n} multiple-choice questions (A-D) about "{topic}" using ONLY '
            "the material below. After each question give 'Answer: <letter>' and a "
            "one-line explanation with page reference.\n\n" + format_context(docs)
        )
        return message_text(get_llm().invoke(prompt).content), docs_to_sources(docs)

    @tool(response_format="content_and_artifact")
    def web_search(query: str):
        """Search the public web (only when documents don't contain the answer)."""
        try:
            try:
                from ddgs import DDGS
            except ImportError:
                from duckduckgo_search import DDGS
            results = list(DDGS().text(query, max_results=4))
        except Exception as exc:
            log.warning("Web search failed: %s", exc)
            return f"Web search unavailable ({type(exc).__name__}).", []
        if not results:
            return "No web results found.", []
        lines, sources = [], []
        for r in results:
            title, href, body = r.get("title", ""), r.get("href", ""), r.get("body", "")
            lines.append(f"{title} ({href}): {body}")
            sources.append({
                "type": "web", "file": title, "page": None,
                "url": href, "snippet": body[:200],
            })
        return "\n\n".join(lines), sources

    return [search_documents, list_documents, summarize_document, generate_quiz, web_search]
