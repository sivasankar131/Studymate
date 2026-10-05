"""LLM access and the plain RAG answer step."""
from functools import lru_cache
from typing import Any, Optional

from langchain_core.documents import Document
from langchain_groq import ChatGroq

from app.config import settings
from app.rag.retriever import docs_to_sources, format_context

NO_DOCS_ANSWER = (
    "I couldn't find anything relevant in your documents. "
    "Upload a document first, or try rephrasing your question."
)

PROMPT = """You are StudyMate, an assistant that answers questions strictly from the user's own documents.

Rules:
- Use ONLY the context below. Do not use outside knowledge.
- If the context does not contain the answer, say: "I couldn't find that in your documents."
- Cite sources inline in the form [file.pdf p.3].
- Be clear and concise.

Context:
{context}

Conversation so far:
{history}

Question: {question}
Answer:"""


@lru_cache(maxsize=1)
def get_llm() -> ChatGroq:
    return ChatGroq(
        model=settings.LLM_MODEL,
        groq_api_key=settings.GROQ_API_KEY,
        temperature=0.2,
    )


def message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        return "".join(parts)
    return str(content)


def answer_question(
    question: str,
    docs: list[Document],
    history: Optional[list[tuple[str, str]]] = None,
) -> dict[str, Any]:
    """Answer from retrieved chunks only, return answer + sources."""
    if not docs:
        return {"answer": NO_DOCS_ANSWER, "sources": []}

    history_text = "\n".join(
        f"{role.title()}: {text}" for role, text in (history or [])[-6:]
    ) or "(none)"

    prompt = PROMPT.format(
        context=format_context(docs),
        history=history_text,
        question=question,
    )
    response = get_llm().invoke(prompt)
    return {
        "answer":  message_text(response.content).strip(),
        "sources": docs_to_sources(docs),
    }
