"""Application settings, loaded from environment variables (or a local .env file)."""

import re

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    # ── Secrets (required) ────────────────────────────────────────────────────
    GROQ_API_KEY: str
    DATABASE_URL: str
    QDRANT_URL: str
    QDRANT_API_KEY: str

    # ── Models ────────────────────────────────────────────────────────────────
    LLM_MODEL: str = "openai/gpt-oss-120b"
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"

    # ── RAG tuning ────────────────────────────────────────────────────────────
    QDRANT_COLLECTION: str = "studymate"
    CHUNK_SIZE: int = 700
    CHUNK_OVERLAP: int = 100
    TOP_K: int = 5

    # ── API behaviour ─────────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:5173"
    MAX_UPLOAD_MB: int = 10

    # ── Indexing safety ───────────────────────────────────────────────────────
    # Hard wall: background thread is allowed this many seconds to finish.
    # After this the thread *may* still run (Python cannot kill a thread),
    # but the DB record will be marked failed so the UI unblocks.
    INDEXING_TIMEOUT_SECONDS: int = 300   # 5 minutes

    # Self-healing sweep: documents stuck in "indexing" for longer than this
    # (likely due to a crashed worker) are marked "failed" automatically.
    INDEXING_STALE_MINUTES: int = 10

    @field_validator("DATABASE_URL")
    @classmethod
    def use_pg8000_driver(cls, v: str) -> str:
        return re.sub(
            r"^postgres(ql)?(\+\w+)?://",
            "postgresql+pg8000://",
            v,
        )

    @property
    def cors_origins(self) -> list[str]:
        return [
            o.strip().rstrip("/")
            for o in self.FRONTEND_URL.split(",")
            if o.strip()
        ]


settings = Settings()
