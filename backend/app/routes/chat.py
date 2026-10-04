"""Chat endpoints: plain RAG (/chat), agent (/agent/chat) and chat history."""
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.graph import run_agent
from app.db.database import get_db
from app.db.models import Document, Message
from app.rag.qa import answer_question
from app.rag.retriever import retrieve

log = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

HISTORY_LIMIT = 10  # previous messages sent to the model for follow-up questions


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=1, max_length=2000)
    doc_id: Optional[str] = Field(default=None, description="Restrict answers to one document")


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]
    tools_used: list[str] = []


class HistoryItem(BaseModel):
    id: int
    role: str
    content: str
    sources: Optional[list[dict[str, Any]]] = None
    created_at: datetime


def _ai_http_error(exc: Exception) -> HTTPException:
    """Turn an LLM/vector-store failure into a clean HTTP error (call inside `except`)."""
    log.exception("AI call failed")
    msg = str(exc).lower()
    if any(s in msg for s in ("429", "quota", "resource_exhausted", "rate limit")):
        return HTTPException(
            status_code=429,
            detail="The AI service is rate-limited right now. Please wait a minute and try again.",
        )
    return HTTPException(
        status_code=503, detail="The AI service is temporarily unavailable. Please try again."
    )


def _check_doc(db: Session, doc_id: Optional[str]) -> None:
    if doc_id and db.get(Document, doc_id) is None:
        raise HTTPException(status_code=404, detail="Document not found.")


def _load_history(db: Session, session_id: str) -> list[tuple[str, str]]:
    rows = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.id.desc())
        .limit(HISTORY_LIMIT)
        .all()
    )
    return [(r.role, r.content) for r in reversed(rows)]


def _save_turn(db: Session, session_id: str, question: str, result: dict[str, Any]) -> None:
    db.add(Message(session_id=session_id, role="user", content=question))
    db.add(
        Message(
            session_id=session_id,
            role="assistant",
            content=result["answer"],
            sources=result["sources"],
        )
    )
    db.commit()


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """Plain RAG: retrieve the best chunks, answer only from them, return sources."""
    _check_doc(db, req.doc_id)
    history = _load_history(db, req.session_id)
    try:
        docs = retrieve(req.question, doc_id=req.doc_id)
        result = answer_question(req.question, docs, history)
    except Exception as exc:
        raise _ai_http_error(exc) from exc
    _save_turn(db, req.session_id, req.question, result)
    return ChatResponse(**result)


@router.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest, db: Session = Depends(get_db)):
    """Agent mode: the model plans its steps and calls tools (search, summarise, quiz, web)."""
    _check_doc(db, req.doc_id)
    history = _load_history(db, req.session_id)
    try:
        result = run_agent(req.question, history, req.doc_id)
    except Exception as exc:
        raise _ai_http_error(exc) from exc
    _save_turn(db, req.session_id, req.question, result)
    return ChatResponse(**result)


@router.get("/history/{session_id}", response_model=list[HistoryItem])
def get_history(session_id: str, db: Session = Depends(get_db)):
    return (
        db.query(Message).filter(Message.session_id == session_id).order_by(Message.id.asc()).all()
    )


@router.delete("/history/{session_id}", status_code=204)
def clear_history(session_id: str, db: Session = Depends(get_db)):
    db.query(Message).filter(Message.session_id == session_id).delete()
    db.commit()
    return Response(status_code=204)
