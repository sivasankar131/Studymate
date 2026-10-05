/**
 * useUpload – manages the upload queue with real backend status polling.
 *
 * Fixed issues:
 *  - File ref was read via setQueue() anti-pattern (async race condition).
 *    Now stored in a stable Map ref keyed by slot id.
 *  - onUploadProgress reaching 100% no longer blocks the UI — the response
 *    is awaited independently; the slot transitions to 'queued' once the
 *    HTTP response arrives (not when bytes finish transferring).
 *  - Polling loop uses setInterval + cleanup, not recursive setTimeout,
 *    to avoid timer leaks across re-renders.
 *  - Double-submit guard uses a ref (not state) to prevent React batching issues.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as api from '@/services/api';
import { validateFile } from '@/utils/validation';
import type { Document, UploadFile } from '@/types';

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 90; // 3 minutes

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

  /**
   * Stable file map — avoids reading File objects out of React state
   * inside async callbacks (which can race with batched state updates).
   */
  const fileMap = useRef<Map<string, File>>(new Map());

  /** documentId → intervalId — one interval per in-flight document */
  const pollIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  /** Slot IDs currently being submitted — prevents double-submit */
  const submitting = useRef<Set<string>>(new Set());

  // Clean up all intervals on unmount
  useEffect(() => {
    return () => {
      pollIntervals.current.forEach(clearInterval);
      pollIntervals.current.clear();
    };
  }, []);

  const updateSlot = useCallback((id: string, patch: Partial<UploadFile>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const stopPolling = useCallback((documentId: string) => {
    const interval = pollIntervals.current.get(documentId);
    if (interval !== undefined) {
      clearInterval(interval);
      pollIntervals.current.delete(documentId);
    }
  }, []);

  const startPolling = useCallback((
    slotId: string,
    documentId: string,
    onSuccess?: (doc: Document) => void,
  ) => {
    if (pollIntervals.current.has(documentId)) return; // already polling

    let attempts = 0;

    const interval = setInterval(async () => {
      attempts += 1;

      // Safety: stop after max attempts
      if (attempts > MAX_POLL_ATTEMPTS) {
        stopPolling(documentId);
        updateSlot(slotId, {
          status: 'error',
          error: 'Processing timed out after 3 minutes. Please try uploading again.',
          progress: 0,
        });
        return;
      }

      try {
        const s = await api.getDocumentStatus(documentId);

        if (s.status === 'ready') {
          stopPolling(documentId);
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
          stopPolling(documentId);
          updateSlot(slotId, {
            status: 'error',
            progress: 0,
            error: s.error_message ?? 'Processing failed. Please try uploading again.',
          });
          return;
        }

        // Map backend status → UI status
        const uiStatus =
          s.status === 'indexing'    ? 'indexing'    :
          s.status === 'processing'  ? 'processing'  :
                                       'queued';
        updateSlot(slotId, { status: uiStatus, progress: s.progress });

      } catch {
        // Network hiccup — keep polling silently
      }
    }, POLL_INTERVAL_MS);

    pollIntervals.current.set(documentId, interval);
  }, [stopPolling, updateSlot]);

  // ── Public API ────────────────────────────────────────────────────────────

  const addFiles = useCallback((files: FileList | File[]) => {
    const slots: UploadFile[] = Array.from(files).map(file => {
      const { valid, error } = validateFile(file);
      const id = uuidv4();
      if (valid) fileMap.current.set(id, file);
      return { id, file, status: valid ? 'pending' : 'error', error };
    });
    setQueue(prev => [...prev, ...slots]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setQueue(prev => {
      const slot = prev.find(s => s.id === id);
      if (slot?.documentId) stopPolling(slot.documentId);
      fileMap.current.delete(id);
      return prev.filter(s => s.id !== id);
    });
  }, [stopPolling]);

  const uploadOne = useCallback(async (
    id: string,
    onSuccess?: (doc: Document) => void,
  ) => {
    // Double-submit guard
    if (submitting.current.has(id)) return;

    // Check slot is in a startable state
    const currentSlot = queue.find(s => s.id === id);
    if (!currentSlot || (currentSlot.status !== 'pending' && currentSlot.status !== 'error')) return;

    submitting.current.add(id);

    // Get file from stable map (avoids async state-read race)
    const file = fileMap.current.get(id) ?? currentSlot.file;
    if (!file) {
      submitting.current.delete(id);
      return;
    }

    updateSlot(id, { status: 'uploading', progress: 0, error: undefined });

    try {
      const doc = await api.uploadDocument(file, pct => {
        // Only update upload percentage — cap at 95 so bar never "reaches 100"
        // while waiting for the HTTP response, which prevents the stuck-at-99% UX.
        updateSlot(id, { status: 'uploading', progress: Math.min(pct, 95) });
      });

      // HTTP response received — transition out of upload immediately
      updateSlot(id, {
        status: 'queued',
        progress: 0,
        documentId: doc.id,
        document: doc,
      });

      startPolling(id, doc.id, onSuccess);

    } catch (err) {
      updateSlot(id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed. Please try again.',
        progress: 0,
      });
    } finally {
      submitting.current.delete(id);
    }
  }, [queue, updateSlot, startPolling]);

  const uploadAll = useCallback(async (onSuccess?: (doc: Document) => void) => {
    const pending = queue.filter(s => s.status === 'pending');
    // Sequential to avoid hammering Render simultaneously
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
