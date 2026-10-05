/**
 * useDocuments – manages the list of uploaded documents.
 *
 * Cancellation contract
 * ─────────────────────
 * Every GET /documents call carries an AbortSignal tied to an AbortController
 * that is aborted on component unmount.  If a request is cancelled (because
 * the user navigated away), isCancelledError() returns true and the error is
 * silently discarded — no setError(), no pollTimedOut, no state update at all.
 *
 * Polling strategy (runs only while ≥1 doc is in-progress)
 * ──────────────────────────────────────────────────────────
 * - Exponential backoff: 2 s → 4 s → 8 s → 15 s → 30 s cap (±10% jitter)
 * - Hard stop after MAX_POLL_ATTEMPTS
 * - Hard stop after MAX_POLL_DURATION_MS wall-clock time
 * - Exactly one timer active at a time
 * - Cleans up timer AND aborts in-flight request on unmount
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/services/api';
import { isCancelledError } from '@/services/api';
import type { Document } from '@/types';

const INITIAL_DELAY_MS     =  2_000;
const MAX_DELAY_MS         = 30_000;
const MAX_POLL_ATTEMPTS    = 40;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

const IN_PROGRESS = new Set(['queued', 'processing', 'indexing']);

function nextDelay(attempt: number): number {
  const base   = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
  const jitter = base * 0.1 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export interface UseDocumentsReturn {
  documents: Document[];
  loading: boolean;
  error: string | null;
  pollTimedOut: boolean;
  refresh: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  deletingId: string | null;
}

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments]       = useState<Document[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const isMounted      = useRef(true);
  const attemptRef     = useRef(0);
  const pollStartRef   = useRef<number | null>(null);

  // ── helpers ──────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abortCurrentRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback((fetchFn: () => Promise<void>) => {
    stopPolling();
    if (!isMounted.current) return;
    if (attemptRef.current >= MAX_POLL_ATTEMPTS) { setPollTimedOut(true); return; }
    if (pollStartRef.current !== null &&
        Date.now() - pollStartRef.current >= MAX_POLL_DURATION_MS) {
      setPollTimedOut(true);
      return;
    }
    const delay = nextDelay(attemptRef.current + 1);
    timerRef.current = setTimeout(() => {
      attemptRef.current += 1;
      void fetchFn();
    }, delay);
  }, [stopPolling]);

  // ── main fetch ────────────────────────────────────────────────────────────

  const fetchDocuments = useCallback(async (isBackgroundPoll = false) => {
    if (!isBackgroundPoll) {
      setLoading(true);
      setError(null);
      setPollTimedOut(false);
      attemptRef.current   = 0;
      pollStartRef.current = null;
    }

    // Create a fresh AbortController for this request
    abortCurrentRequest();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const docs = await api.getDocuments(controller.signal);

      // If we were cancelled, bail silently
      if (controller.signal.aborted || !isMounted.current) return;

      setDocuments(docs);
      setError(null);

      const hasInProgress = docs.some(d => IN_PROGRESS.has(d.status));
      if (hasInProgress) {
        if (pollStartRef.current === null) pollStartRef.current = Date.now();
        schedulePoll(() => fetchDocuments(true));
      } else {
        stopPolling();
        attemptRef.current   = 0;
        pollStartRef.current = null;
      }
    } catch (err) {
      // ── Intentional cancellation — completely silent ─────────────────────
      if (isCancelledError(err) || controller.signal.aborted) return;
      if (!isMounted.current) return;

      // ── Real network/server error ────────────────────────────────────────
      if (!isBackgroundPoll) {
        setError(err instanceof Error ? err.message : 'Failed to load documents.');
      }
      // Back off and retry on background poll errors (429, 5xx, transient)
      if (isBackgroundPoll) {
        schedulePoll(() => fetchDocuments(true));
      }
    } finally {
      if (!isBackgroundPoll && isMounted.current) {
        setLoading(false);
      }
    }
  }, [abortCurrentRequest, schedulePoll, stopPolling]);

  // ── public refresh ────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    stopPolling();
    abortCurrentRequest();
    attemptRef.current   = 0;
    pollStartRef.current = null;
    setPollTimedOut(false);
    await fetchDocuments(false);
  }, [fetchDocuments, stopPolling, abortCurrentRequest]);

  // ── lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    isMounted.current = true;
    void fetchDocuments(false);
    return () => {
      isMounted.current = false;
      stopPolling();
      abortCurrentRequest();
    };
  }, [fetchDocuments, stopPolling, abortCurrentRequest]);

  // ── delete ────────────────────────────────────────────────────────────────

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
