"""Database tables: uploaded documents and chat history."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)

    # Browser-level owner.  Every document belongs to exactly one client.
    # NOT NULL with a sentinel value for rows that existed before isolation
    # was introduced (migration sets them to 'legacy-pre-isolation').
    client_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="legacy-pre-isolation",
        index=True,
    )

    filename: Mapped[str] = mapped_column(String(255))
    num_pages: Mapped[int] = mapped_column(Integer, default=0)
    num_chunks: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    # Processing pipeline status: queued | processing | indexing | ready | failed
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Composite index speeds up the most common query:
    # WHERE client_id = ? ORDER BY created_at DESC
    __table_args__ = (
        Index("ix_documents_client_created", "client_id", "created_at"),
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # client_id scopes history to a browser; session_id scopes it to one
    # conversation within that browser.
    client_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="legacy-pre-isolation",
        index=True,
    )
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16))   # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
