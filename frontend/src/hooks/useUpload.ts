/**
 * useUpload – manages the upload queue.
 *
 * Responsibilities:
 *  - Validate files before upload (type + size)
 *  - Track per-file upload status & progress
 *  - Call POST /upload for each file
 *  - Notify parent when a document is ready (onSuccess callback)
 */

import { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as api from '@/services/api';
import { validateFile } from '@/utils/validation';
import type { UploadFile, Document } from '@/types';

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

  /** Update a single slot in the queue immutably */
  const updateSlot = useCallback((id: string, patch: Partial<UploadFile>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const slots: UploadFile[] = arr.map((file) => {
      const { valid, error } = validateFile(file);
      return {
        id: uuidv4(),
        file,
        status: valid ? 'pending' : 'error',
        error: valid ? undefined : error,
      };
    });
    setQueue((prev) => [...prev, ...slots]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const uploadOne = useCallback(
    async (id: string, onSuccess?: (doc: Document) => void) => {
      setQueue((prev) => {
        const slot = prev.find((s) => s.id === id);
        if (!slot || slot.status === 'error') return prev;
        return prev.map((s) =>
          s.id === id ? { ...s, status: 'uploading', progress: 0 } : s,
        );
      });

      // Grab the file reference before the async call
      let file: File | undefined;
      setQueue((prev) => {
        file = prev.find((s) => s.id === id)?.file;
        return prev;
      });

      // Give React a tick to set the file ref
      await new Promise<void>((r) => setTimeout(r, 0));

      // Re-read from current state
      setQueue((current) => {
        file = current.find((s) => s.id === id)?.file;
        return current;
      });

      if (!file) return;

      try {
        // Mark "uploading" with progress tracking
        updateSlot(id, { status: 'uploading', progress: 0 });

        const doc = await api.uploadDocument(file, (pct) => {
          // 0-90% is network upload; 90-100% is backend processing
          updateSlot(id, {
            status: pct < 100 ? 'uploading' : 'processing',
            progress: pct < 100 ? pct : 95,
          });
        });

        updateSlot(id, { status: 'done', progress: 100, document: doc });
        onSuccess?.(doc);
      } catch (err) {
        updateSlot(id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed.',
          progress: 0,
        });
      }
    },
    [updateSlot],
  );

  const uploadAll = useCallback(
    async (onSuccess?: (doc: Document) => void) => {
      const pending = queue.filter((s) => s.status === 'pending');
      // Upload sequentially to avoid hammering the backend
      for (const slot of pending) {
        await uploadOne(slot.id, onSuccess);
      }
    },
    [queue, uploadOne],
  );

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((s) => s.status !== 'done'));
  }, []);

  const isUploading = queue.some(
    (s) => s.status === 'uploading' || s.status === 'processing',
  );

  return { queue, addFiles, removeFile, uploadAll, uploadOne, clearCompleted, isUploading };
}
