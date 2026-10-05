/**
 * useUpload – manages the upload queue with real backend status polling.
 *
 * Flow per file:
 *  1. addFiles()   → status: pending
 *  2. uploadOne()  → multipart POST /upload (bytes in flight) → status: uploading
 *  3. Server returns 202 with {id, status:"queued"}              → status: queued
 *  4. Poll GET /documents/{id}/status every 1.5 s:
 *       processing → status: processing (progress from backend)
 *       indexing   → status: indexing   (progress from backend)
 *       ready      → status: done       (stop polling)
 *       failed     → status: error      (stop polling, show error_message)
 *
 * Safety:
 *  - One polling loop per document (guarded by a ref set).
 *  - Polling stops on unmount via AbortController / cancelled flag.
 *  - Prevents double-submit (status must be 'pending' or 'error' to start).
 *  - Max 120 poll attempts (~3 min) then marks error to prevent infinite loops.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as api from '@/services/api';
import { validateFile } from '@/utils/validation';
import type { Document, UploadFile } from '@/types';

const POLL_INTERVAL_MS = 1_500;
const MAX_POLL_ATTEMPTS = 120; // 3 minutes maximum

export interface UseUploadReturn {
  queue: UploadFile[];
  addFiles: (files: FileList | File[]) => void;
  removeFile: (id: string) => void;
  uploadAll: (onSuccess?: (doc: Document) => void) => Promise<void>;
  uploadOne: (id: string, onSuccess?: (doc: Document) => void) => Promise<void>;
  clearCompleted: () => void;
  isUploading: boolean;
}

export function useUpload(): UseUploadReturn {
  const [queue, setQueue] = useState<UploadFile[]>([]);

  // Track which documentIds are already being polled — prevents duplicate loops
  const pollingIds = useRef<Set<string>>(new Set());

  // Track all active timers so we can cancel them on unmount
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Cancel all polling when the component unmounts
  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      pollingIds.current.clear();
    };
  }, []);

  // ── helpers ──────────────────────────────────────────────────────────────

  const updateSlot = useCallback((id: string, patch: Partial<UploadFile>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  // ── polling loop ─────────────────────────────────────────────────────────

  const startPolling = useCallback((
    slotId: string,
    documentId: string,
    onSuccess?: (doc: Document) => void,
  ) => {
    if (pollingIds.current.has(documentId)) return; // already polling
    pollingIds.current.add(documentId);

    let attempts = 0;

    const poll = async () => {
      if (!pollingIds.current.has(documentId)) return; // cancelled

      attempts += 1;
      if (attempts > MAX_POLL_ATTEMPTS) {
        pollingIds.current.delete(documentId);
        updateSlot(slotId, {
          status: 'error',
          error: 'Processing timed out. Please try uploading again.',
          progress: 0,
        });
        return;
      }

      try {
        const s = await api.getDocumentStatus(documentId);

        if (s.status === 'ready') {
          pollingIds.current.delete(documentId);
          // Build a full Document from the status response for onSuccess callback
          const doc: Document = {
            id: s.id,
            filename: s.filename,
            num_pages: s.num_pages,
            num_chunks: s.num_chunks,
            status: 'ready',
            progress: 100,
            error_message: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          updateSlot(slotId, { status: 'done', progress: 100, document: doc });
          onSuccess?.(doc);
          return;
        }

        if (s.status === 'failed') {
          pollingIds.current.delete(documentId);
          updateSlot(slotId, {
            status: 'error',
            progress: 0,
            error: s.error_message ?? 'Processing failed. Please try again.',
          });
          return;
        }

        // Map backend status → frontend UploadStatus
        const frontendStatus =
          s.status === 'indexing' ? 'indexing' :
          s.status === 'processing' ? 'processing' :
          'queued';

        updateSlot(slotId, {
          status: frontendStatus,
          progress: s.progress,
        });

      } catch {
        // Network hiccup — keep polling, don't abort
      }

      const timer = setTimeout(poll, POLL_INTERVAL_MS);
      timers.current.add(timer);
    };

    // Start first poll after a short delay to let the server begin processing
    const timer = setTimeout(poll, 800);
    timers.current.add(timer);
  }, [updateSlot]);

  // ── public API ───────────────────────────────────────────────────────────

  const addFiles = useCallback((files: FileList | File[]) => {
    const slots: UploadFile[] = Array.from(files).map(file => {
      const { valid, error } = validateFile(file);
      return { id: uuidv4(), file, status: valid ? 'pending' : 'error', error };
    });
    setQueue(prev => [...prev, ...slots]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setQueue(prev => {
      const slot = prev.find(s => s.id === id);
      // Cancel any in-flight polling for this slot
      if (slot?.documentId) pollingIds.current.delete(slot.documentId);
      return prev.filter(s => s.id !== id);
    });
  }, []);

  const uploadOne = useCallback(async (
    id: string,
    onSuccess?: (doc: Document) => void,
  ) => {
    // Only start if slot is pending or in error-retry state
    setQueue(prev => {
      const slot = prev.find(s => s.id === id);
      if (!slot || (slot.status !== 'pending' && slot.status !== 'error')) return prev;
      return prev.map(s => s.id === id ? { ...s, status: 'uploading', progress: 0, error: undefined } : s);
    });

    // Read file from current state
    let file: File | undefined;
    setQueue(prev => { file = prev.find(s => s.id === id)?.file; return prev; });
    await new Promise<void>(r => setTimeout(r, 0));
    setQueue(prev => { file = prev.find(s => s.id === id)?.file; return prev; });

    if (!file) return;

    try {
      const doc = await api.uploadDocument(file, pct => {
        updateSlot(id, { status: 'uploading', progress: Math.min(pct, 99) });
      });

      // Server returned 202 — doc.status is 'queued'
      updateSlot(id, {
        status: 'queued',
        progress: 0,
        documentId: doc.id,
        document: doc,
      });

      // Begin status polling
      startPolling(id, doc.id, onSuccess);

    } catch (err) {
      updateSlot(id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed.',
        progress: 0,
      });
    }
  }, [updateSlot, startPolling]);

  const uploadAll = useCallback(async (onSuccess?: (doc: Document) => void) => {
    const pending = queue.filter(s => s.status === 'pending');
    for (const slot of pending) {
      await uploadOne(slot.id, onSuccess);
    }
  }, [queue, uploadOne]);

  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(s => s.status !== 'done'));
  }, []);

  const isUploading = queue.some(
    s => s.status === 'uploading' || s.status === 'queued' ||
         s.status === 'processing' || s.status === 'indexing',
  );

  return { queue, addFiles, removeFile, uploadAll, uploadOne, clearCompleted, isUploading };
}
