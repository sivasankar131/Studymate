"""Chat endpoints — scoped to a browser client_id for full data isolation.

Every request must include X-Client-ID.
Retrieval, history reads, and history writes are all filtered by client_id.
"""
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.graph import run_agent
from app.db.database import get_db
from app.db.models import Document, Message
from app.dependencies import get_client_id
from app.rag.qa import answer_question
from app.rag.retriever import retrieve

log = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

HISTORY_LIMIT = 10


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    question:   str = Field(min_length=1, max_length=2000)
    doc_id:     Optional[str] = Field(default=None)


class ChatResponse(BaseModel):
    answer:     str
    sources:    list[dict[str, Any]]
    tools_used: list[str] = []


class HistoryItem(BaseModel):
    id:         int
    role:       str
    content:    str
    sources:    Optional[list[dict[str, Any]]] = None
    created_at: datetime


def _ai_http_error(exc: Exception) -> HTTPException:
    log.exception("AI call failed")
    msg = str(exc).lower()
    if any(s in msg for s in ("429", "quota", "resource_exhausted", "rate limit")):
        return HTTPException(
            status_code=429,
            detail="The AI service is rate-limited right now. Please wait a minute and try again.",
        )
    return HTTPException(
        status_code=503,
        detail="The AI service is temporarily unavailable. Please try again.",
    )


def _check_doc(db: Session, doc_id: Optional[str], client_id: str) -> None:
    """Verify that the doc exists AND belongs to this client."""
    if doc_id is None:
        return
    doc = db.get(Document, doc_id)
    if doc is None or doc.client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found.")


def _load_history(db: Session, session_id: str, client_id: str) -> list[tuple[str, str]]:
    """Load recent messages scoped to (client_id, session_id)."""
    rows = (
        db.query(Message)
        .filter(
            Message.client_id  == client_id,
            Message.session_id == session_id,
        )
        .order_by(Message.id.desc())
        .limit(HISTORY_LIMIT)
        .all()
    )
    return [(r.role, r.content) for r in reversed(rows)]


def _save_turn(
    db: Session,
    session_id: str,
    client_id: str,
    question: str,
    result: dict[str, Any],
) -> None:
    """Persist a conversation turn tagged with both client_id and session_id."""
    db.add(Message(
        client_id=client_id, session_id=session_id,
        role="user", content=question,
    ))
    db.add(Message(
        client_id=client_id, session_id=session_id,
        role="assistant", content=result["answer"],
        sources=result["sources"],
    ))
    db.commit()


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Plain RAG: retrieve only this client's chunks, answer, return sources."""
    _check_doc(db, req.doc_id, client_id)
    history = _load_history(db, req.session_id, client_id)
    try:
        # retrieve() ALWAYS requires client_id — no global fallback
        docs   = retrieve(req.question, client_id=client_id, doc_id=req.doc_id)
        result = answer_question(req.question, docs, history)
    except Exception as exc:
        raise _ai_http_error(exc) from exc
    _save_turn(db, req.session_id, client_id, req.question, result)
    return ChatResponse(**result)


@router.post("/agent/chat", response_model=ChatResponse)
def agent_chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Agent mode: tools are scoped to this client's documents."""
    _check_doc(db, req.doc_id, client_id)
    history = _load_history(db, req.session_id, client_id)
    try:
        result = run_agent(req.question, history, client_id=client_id, doc_id=req.doc_id)
    except Exception as exc:
        raise _ai_http_error(exc) from exc
    _save_turn(db, req.session_id, client_id, req.question, result)
    return ChatResponse(**result)


@router.get("/history/{session_id}", response_model=list[HistoryItem])
def get_history(
    session_id: str,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Return conversation history scoped to this client + session."""
    return (
        db.query(Message)
        .filter(
            Message.client_id  == client_id,
            Message.session_id == session_id,
        )
        .order_by(Message.id.asc())
        .all()
    )


@router.delete("/history/{session_id}", status_code=204)
def clear_history(
    session_id: str,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
):
    """Clear only this client's messages for a session."""
    db.query(Message).filter(
        Message.client_id  == client_id,
        Message.session_id == session_id,
    ).delete()
    db.commit()
    return Response(status_code=204)
