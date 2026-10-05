-- Migration 001: add client_id to documents and messages tables
-- Run this ONCE against your production PostgreSQL database before deploying
-- the new backend code.
--
-- Safe strategy for existing rows:
--   Rows that existed before isolation was introduced are assigned the
--   sentinel value 'legacy-pre-isolation'.  The new backend code rejects
--   any X-Client-ID header equal to that sentinel, so legacy rows become
--   effectively invisible to all browsers — they will not be accidentally
--   served to a new client.  If you want to delete them instead, run the
--   optional cleanup block at the bottom.

BEGIN;

-- ── documents table ──────────────────────────────────────────────────────────

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS client_id VARCHAR(64)
        NOT NULL DEFAULT 'legacy-pre-isolation';

-- Index for the common query pattern: WHERE client_id = ? ORDER BY created_at
CREATE INDEX IF NOT EXISTS ix_documents_client_created
    ON documents (client_id, created_at DESC);

-- ── messages table ───────────────────────────────────────────────────────────

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS client_id VARCHAR(64)
        NOT NULL DEFAULT 'legacy-pre-isolation';

CREATE INDEX IF NOT EXISTS ix_messages_client_id
    ON messages (client_id);

COMMIT;

-- ── Optional cleanup: remove all pre-isolation data ─────────────────────────
-- Uncomment and run separately if you want a clean slate.
-- WARNING: this permanently deletes documents and messages created before
-- the isolation upgrade.
--
-- BEGIN;
-- DELETE FROM documents WHERE client_id = 'legacy-pre-isolation';
-- DELETE FROM messages  WHERE client_id = 'legacy-pre-isolation';
-- COMMIT;
