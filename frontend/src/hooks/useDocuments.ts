/**
 * useDocuments – manages the list of uploaded documents.
 *
 * Responsibilities:
 *  - Fetch the document list from GET /documents on mount and on demand
 *  - Expose a deleteDocument action that calls DELETE /documents/{id}
 *  - Track loading / error state
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/services/api';
import type { Document } from '@/types';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const docs = await api.getDocuments();
      setDocuments(docs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteDocument = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await api.deleteDocument(id);
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        throw err; // let the caller surface the error
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  return { documents, loading, error, refresh, deleteDocument, deletingId };
}
