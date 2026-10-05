"""Reusable FastAPI dependencies for StudyMate."""
import re
import uuid

from fastapi import Header, HTTPException

# Sentinel assigned to rows that existed before client isolation was added.
# We reject it as a valid client ID so legacy data is never served.
LEGACY_CLIENT_ID = "legacy-pre-isolation"

# UUID v4 pattern (with or without hyphens, 32–36 chars)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-?[0-9a-f]{4}-?4[0-9a-f]{3}-?[89ab][0-9a-f]{3}-?[0-9a-f]{12}$",
    re.IGNORECASE,
)


def get_client_id(x_client_id: str = Header(..., alias="X-Client-ID")) -> str:
    """
    FastAPI dependency — extracts and validates the browser identity header.

    Rules
    -----
    - Header X-Client-ID must be present.
    - Value must be a valid UUID v4 (hyphens optional).
    - The legacy sentinel value is explicitly rejected.

    Returns the normalised (lower-case, no hyphens) client ID string.
    Raises HTTP 400 for any validation failure.
    """
    cid = x_client_id.strip()

    if not cid:
        raise HTTPException(status_code=400, detail="X-Client-ID header is required.")

    if cid == LEGACY_CLIENT_ID:
        raise HTTPException(
            status_code=400,
            detail="X-Client-ID value is reserved and not allowed.",
        )

    if not _UUID_RE.match(cid):
        raise HTTPException(
            status_code=400,
            detail="X-Client-ID must be a valid UUID v4.",
        )

    # Normalise to lower-case without hyphens for consistent DB/Qdrant storage
    return cid.lower().replace("-", "")
