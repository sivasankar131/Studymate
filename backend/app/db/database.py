"""SQLAlchemy engine, session factory and declarative base."""
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

# Neon/Supabase connection strings carry libpq-style options (sslmode, channel_binding)
# that the pure-Python pg8000 driver does not understand, so translate them here.
_url = make_url(settings.DATABASE_URL)
_connect_args: dict = {}
if _url.get_backend_name() == "postgresql":
    if _url.query.get("sslmode") not in (None, "disable"):
        _connect_args["ssl_context"] = True  # use SSL with the default context
    _url = _url.difference_update_query(["sslmode", "channel_binding"])

# pool_pre_ping + pool_recycle keep connections healthy when Neon/Supabase
# suspend idle databases.
engine = create_engine(_url, pool_pre_ping=True, pool_recycle=300, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    """FastAPI dependency: one session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables if they do not exist yet."""
    from app.db import models  # noqa: F401  (registers the models on Base)

    Base.metadata.create_all(bind=engine)