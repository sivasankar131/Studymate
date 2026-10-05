/**
 * useDocuments – manages the list of uploaded documents.
 *
 * Responsibilities:
 *  - Fetch GET /documents on mount
 *  - Auto-poll every 3 s while any document is in a non-terminal state
 *    (queued | processing | indexing) so the UI reflects backend progress
 *    without the user having to refresh manually
 *  - Stop polling once all documents are terminal (ready | failed)
 *  - Expose a deleteDocument action and a manual refresh
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/services/api';
import type { Document } from '@/types';

const POLL_INTERVAL_MS = 3_000;

/** States that mean the document is still being processed */
const IN_PROGRESS = new Set(['queued', 'processing', 'indexing']);

export interface UseDocumentsReturn {
  documents: Document[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  deletingId: string | null;
}

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const fetchDocuments = useCallback(async (isBackgroundPoll = false) => {
    // Don't show the full loading spinner on background polls —
    // only on the initial load or manual refresh
    if (!isBackgroundPoll) {
      setLoading(true);
      setError(null);
    }
    try {
      const docs = await api.getDocuments();
      if (!isMounted.current) return;
      setDocuments(docs);
      setError(null);

      // Schedule next poll if any document is still in-progress
      const hasInProgress = docs.some(d => IN_PROGRESS.has(d.status));
      if (hasInProgress) {
        stopPolling();
        pollTimer.current = setTimeout(() => {
          void fetchDocuments(true);
        }, POLL_INTERVAL_MS);
      } else {
        stopPolling(); // all terminal — stop
      }
    } catch (err) {
      if (!isMounted.current) return;
      // Only surface error on non-background polls to avoid flash of error
      // during a transient network hiccup mid-processing
      if (!isBackgroundPoll) {
        setError(err instanceof Error ? err.message : 'Failed to load documents.');
      }
    } finally {
      if (!isBackgroundPoll && isMounted.current) {
        setLoading(false);
      }
    }
  }, [stopPolling]);

  // Public refresh (full reload with loading state)
  const refresh = useCallback(async () => {
    stopPolling();
    await fetchDocuments(false);
  }, [fetchDocuments, stopPolling]);

  // Initial fetch on mount
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
    } catch (err) {
      throw err;
    } finally {
      setDeletingId(null);
    }
  }, []);

  return { documents, loading, error, refresh, deleteDocument, deletingId };
}
