/**
 * Centralized API service for StudyMate.
 * All backend calls go through this module — no fetch/axios elsewhere.
 *
 * Endpoints used:
 *   POST   /upload
 *   GET    /documents
 *   GET    /documents/{id}/status   ← NEW (status polling)
 *   DELETE /documents/{id}
 *   POST   /chat
 *   POST   /agent/chat
 *   GET    /history/{session_id}
 *   DELETE /history/{session_id}
 *   GET    /health
 *   GET    /health/ready
 */

import axios, { AxiosError, type AxiosProgressEvent } from 'axios';
import { getApiBase } from '@/utils/env';
import type {
  ChatRequest,
  ChatResponse,
  Document,
  DocumentStatusResponse,
  HealthReady,
  HistoryItem,
} from '@/types';

// ─── Axios instance ──────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: getApiBase(),
  // 30 s for normal requests; the upload itself is fast now (returns 202 quickly).
  // LLM chat calls can take longer — set per-request where needed.
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

// ─── Error normalisation ─────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function normalise(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError<{ detail?: string | unknown }>;
    const status = ae.response?.status ?? 0;
    const raw = ae.response?.data?.detail;
    const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);

    if (status === 0 || ae.code === 'ECONNABORTED' || ae.code === 'ERR_NETWORK') {
      throw new ApiError(
        0,
        'Unable to connect to the StudyMate backend. Please check that the server is running.',
      );
    }
    if (status === 400) throw new ApiError(status, detail ?? 'Bad request.');
    if (status === 404) throw new ApiError(status, detail ?? 'Resource not found.');
    if (status === 413) throw new ApiError(status, detail ?? `File is too large. Maximum size is 10 MB.`);
    if (status === 422) throw new ApiError(status, detail ?? 'Could not process this file.');
    if (status === 429)
      throw new ApiError(status, detail ?? 'The AI service is rate-limited. Please wait a moment.');
    if (status === 502 || status === 503)
      throw new ApiError(status, detail ?? 'The AI service is temporarily unavailable. Please try again.');

    throw new ApiError(status, detail ?? `Unexpected error (${status}).`);
  }
  throw err;
}

// ─── Document endpoints ──────────────────────────────────────────────────────

/**
 * Upload a file. Backend returns 202 quickly (status = "queued").
 * Actual ingestion runs in the background — poll getDocumentStatus() for progress.
 */
export async function uploadDocument(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Document> {
  const form = new FormData();
  form.append('file', file);
  try {
    const { data } = await client.post<Document>('/upload', form, {
      timeout: 60_000,   // generous timeout only for the file transfer itself
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
    return data;
  } catch (err) {
    normalise(err);
  }
}

/**
 * Poll GET /documents/{id}/status to track background ingestion progress.
 * Returns the lightweight DocumentStatusResponse shape.
 */
export async function getDocumentStatus(docId: string): Promise<DocumentStatusResponse> {
  try {
    const { data } = await client.get<DocumentStatusResponse>(`/documents/${docId}/status`);
    return data;
  } catch (err) {
    normalise(err);
  }
}

/** Fetch all uploaded documents ordered by created_at desc */
export async function getDocuments(): Promise<Document[]> {
  try {
    const { data } = await client.get<Document[]>('/documents');
    return data;
  } catch (err) {
    normalise(err);
  }
}

/** Permanently delete a document and its vectors */
export async function deleteDocument(docId: string): Promise<void> {
  try {
    await client.delete(`/documents/${docId}`);
  } catch (err) {
    normalise(err);
  }
}

// ─── Chat endpoints ──────────────────────────────────────────────────────────

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  try {
    const { data } = await client.post<ChatResponse>('/chat', req, { timeout: 120_000 });
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function sendAgentChat(req: ChatRequest): Promise<ChatResponse> {
  try {
    const { data } = await client.post<ChatResponse>('/agent/chat', req, { timeout: 120_000 });
    return data;
  } catch (err) {
    normalise(err);
  }
}

// ─── History endpoints ───────────────────────────────────────────────────────

export async function getHistory(sessionId: string): Promise<HistoryItem[]> {
  try {
    const { data } = await client.get<HistoryItem[]>(`/history/${sessionId}`);
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function clearHistory(sessionId: string): Promise<void> {
  try {
    await client.delete(`/history/${sessionId}`);
  } catch (err) {
    normalise(err);
  }
}

// ─── Health endpoints ────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string }> {
  try {
    const { data } = await client.get<{ status: string }>('/health');
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function getHealthReady(): Promise<HealthReady> {
  try {
    const { data } = await client.get<HealthReady>('/health/ready');
    return data;
  } catch (err) {
    normalise(err);
  }
}
