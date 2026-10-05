/**
 * useDocuments – manages the list of uploaded documents.
 *
 * Polling strategy (runs only when ≥1 document is in-progress)
 * ─────────────────────────────────────────────────────────────
 * - Exponential backoff: 2s → 4s → 8s → 15s → 30s cap
 * - Hard stop after MAX_POLL_ATTEMPTS attempts
 * - Hard stop after MAX_POLL_DURATION_MS wall-clock time
 * - Exactly one timer active at a time (ref-guarded, cleaned on unmount)
 * - Stops immediately when all documents reach a terminal state
 * - HTTP errors (429/5xx/network) are backed off silently
 *
 * Browser-isolation:  X-Client-ID is injected by the Axios interceptor in
 * api.ts — this hook never needs to handle it explicitly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/services/api';
import type { Document } from '@/types';

// ── Polling configuration ─────────────────────────────────────────────────────

const INITIAL_DELAY_MS    =  2_000;   // 2 s first retry
const MAX_DELAY_MS        = 30_000;   // 30 s cap
const MAX_POLL_ATTEMPTS   = 40;       // ~20 min worst case at 30s cap
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;  // 10 min hard wall

/** States that mean the document is still being processed */
const IN_PROGRESS = new Set(['queued', 'processing', 'indexing']);

function nextDelay(attempt: number): number {
  // Exponential backoff with a small random jitter (±10%) to avoid thundering herd
  const base  = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
  const jitter = base * 0.1 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export interface UseDocumentsReturn {
  documents: Document[];
  loading: boolean;
  error: string | null;
  /** Set when polling stops due to hitting the max duration/attempt limit */
  pollTimedOut: boolean;
  refresh: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  deletingId: string | null;
}

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments]     = useState<Document[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted     = useRef(true);
  const attemptRef    = useRef(0);
  const pollStartRef  = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback((fetchFn: () => Promise<void>) => {
    stopPolling();
    const attempt = attemptRef.current;

    // Hard stop: too many attempts
    if (attempt >= MAX_POLL_ATTEMPTS) {
      setPollTimedOut(true);
      return;
    }

    // Hard stop: wall-clock duration exceeded
    if (pollStartRef.current !== null) {
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed >= MAX_POLL_DURATION_MS) {
        setPollTimedOut(true);
        return;
      }
    }

    const delay = nextDelay(attempt + 1);
    timerRef.current = setTimeout(() => {
      attemptRef.current += 1;
      void fetchFn();
    }, delay);
  }, [stopPolling]);

  const fetchDocuments = useCallback(async (isBackgroundPoll = false) => {
    if (!isBackgroundPoll) {
      setLoading(true);
      setError(null);
      setPollTimedOut(false);
      attemptRef.current  = 0;
      pollStartRef.current = null;
    }

    try {
      const docs = await api.getDocuments();
      if (!isMounted.current) return;

      setDocuments(docs);
      setError(null);

      const hasInProgress = docs.some(d => IN_PROGRESS.has(d.status));

      if (hasInProgress) {
        // Record when we first noticed in-progress docs
        if (pollStartRef.current === null) {
          pollStartRef.current = Date.now();
        }
        // Use a local ref to fetchDocuments so schedulePoll captures the latest closure
        schedulePoll(() => fetchDocuments(true));
      } else {
        // All terminal — stop polling and reset counters
        stopPolling();
        attemptRef.current   = 0;
        pollStartRef.current = null;
      }
    } catch (err) {
      if (!isMounted.current) return;
      if (!isBackgroundPoll) {
        setError(err instanceof Error ? err.message : 'Failed to load documents.');
      }
      // On error during background poll: back off but keep trying
      // (unless we've hit the hard limits — schedulePoll checks those)
      if (isBackgroundPoll) {
        schedulePoll(() => fetchDocuments(true));
      }
    } finally {
      if (!isBackgroundPoll && isMounted.current) {
        setLoading(false);
      }
    }
  }, [schedulePoll, stopPolling]);

  // Public refresh — resets all counters and does a full reload
  const refresh = useCallback(async () => {
    stopPolling();
    attemptRef.current   = 0;
    pollStartRef.current = null;
    setPollTimedOut(false);
    await fetchDocuments(false);
  }, [fetchDocuments, stopPolling]);

  // Mount / unmount
  useEffect(() => {
    isMounted.current = true;
    void fetchDocuments(false);
    return () => {
      isMounted.current = false;
      stopPolling();
    };
  }, [fetchDocuments, stopPolling]);

  const deleteDocument = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteDocument(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return { documents, loading, error, pollTimedOut, refresh, deleteDocument, deletingId };
}
