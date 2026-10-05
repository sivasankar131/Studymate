/**
 * Centralized API service for StudyMate.
 *
 * Every request automatically carries:
 *   X-Client-ID: <stable browser UUID from localStorage>
 *
 * Cancellation contract
 * ─────────────────────
 * When an Axios request is cancelled (AbortController.abort() or
 * axios.CancelToken), the error has code === 'ERR_CANCELED' or
 * name === 'CanceledError'.  normalise() detects this and throws a
 * CancelledError instead of an ApiError so callers can distinguish:
 *
 *   catch (err) {
 *     if (isCancelledError(err)) return;   // silent — expected lifecycle
 *     // real error handling
 *   }
 */

import axios, { AxiosError, type AxiosProgressEvent } from 'axios';
import { getApiBase } from '@/utils/env';
import { getClientId } from '@/utils/client';
import type {
  ChatRequest,
  ChatResponse,
  Document,
  DocumentStatusResponse,
  HealthReady,
  HistoryItem,
} from '@/types';

// ─── Axios instance ───────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: getApiBase(),
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

client.interceptors.request.use(config => {
  config.headers['X-Client-ID'] = getClientId();
  return config;
});

// ─── Cancellation sentinel ────────────────────────────────────────────────────

/**
 * Thrown when a request was intentionally cancelled (component unmount,
 * navigation, or explicit abort).  Callers should treat this as a no-op.
 */
export class CancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'CancelledError';
  }
}

/** Returns true when `err` represents an intentional cancellation. */
export function isCancelledError(err: unknown): err is CancelledError {
  if (err instanceof CancelledError) return true;
  // DOMException AbortError (native fetch / AbortController)
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error) {
    if (err.name === 'CanceledError') return true;   // axios v1 spelling
    if (err.name === 'AbortError')    return true;
  }
  if (axios.isAxiosError(err)) {
    const code = (err as AxiosError).code;
    if (code === 'ERR_CANCELED') return true;        // axios cancel via AbortSignal
  }
  return false;
}

// ─── Error normalisation ──────────────────────────────────────────────────────

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

function extractDetail(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data.replace(/<[^>]+>/g, '').trim().slice(0, 200) || null;
  if (typeof data === 'object') {
    const d = (data as Record<string, unknown>).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((e: unknown) => (e as Record<string, unknown>)?.msg).join('; ');
  }
  return null;
}

function normalise(err: unknown): never {
  // ── Intentional cancellation — not a real error ──────────────────────────
  if (isCancelledError(err)) throw new CancelledError();

  if (axios.isAxiosError(err)) {
    const ae     = err as AxiosError;
    const status = ae.response?.status ?? 0;
    const detail = extractDetail(ae.response?.data) ?? '';

    if (status === 0 || ae.code === 'ECONNABORTED' || ae.code === 'ERR_NETWORK') {
      throw new ApiError(0, 'Unable to connect to the StudyMate backend. Please check that the server is running.');
    }
    if (ae.code === 'ETIMEDOUT' || status === 524 || status === 408) {
      throw new ApiError(status, 'The request timed out. The server may be starting up — please try again.');
    }
    if (status === 400) throw new ApiError(status, detail || 'Bad request.');
    if (status === 404) throw new ApiError(status, detail || 'Resource not found.');
    if (status === 413) throw new ApiError(status, detail || 'File is too large. Maximum size is 10 MB.');
    if (status === 422) throw new ApiError(status, detail || 'Could not process this file.');
    if (status === 429) throw new ApiError(status, detail || 'The AI service is rate-limited. Please wait a moment.');
    if (status === 500) throw new ApiError(status, detail || 'Internal server error. Please try again.');
    if (status === 502) throw new ApiError(status, detail || 'Backend is temporarily unavailable (502). Please try again.');
    if (status === 503) throw new ApiError(status, detail || 'Backend is starting up. Please wait a moment and try again.');
    throw new ApiError(status, detail || `Unexpected error (${status}).`);
  }
  if (err instanceof Error) throw new ApiError(0, err.message);
  throw new ApiError(0, 'An unexpected error occurred.');
}

// ─── Document endpoints ───────────────────────────────────────────────────────

export async function uploadDocument(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<Document> {
  const form = new FormData();
  form.append('file', file);
  try {
    const { data } = await client.post<Document>('/upload', form, {
      timeout: 90_000,
      signal,
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (onProgress && e.total && e.total > 0) {
          onProgress(Math.min(Math.round((e.loaded * 100) / e.total), 95));
        }
      },
    });
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function getDocumentStatus(
  docId: string,
  signal?: AbortSignal,
): Promise<DocumentStatusResponse> {
  try {
    const { data } = await client.get<DocumentStatusResponse>(
      `/documents/${docId}/status`,
      { signal },
    );
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function getDocuments(signal?: AbortSignal): Promise<Document[]> {
  try {
    const { data } = await client.get<Document[]>('/documents', { signal });
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  try {
    await client.delete(`/documents/${docId}`);
  } catch (err) {
    normalise(err);
  }
}

// ─── Chat endpoints ───────────────────────────────────────────────────────────

export async function sendChat(
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  try {
    const { data } = await client.post<ChatResponse>('/chat', req, {
      timeout: 120_000,
      signal,
    });
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function sendAgentChat(
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  try {
    const { data } = await client.post<ChatResponse>('/agent/chat', req, {
      timeout: 120_000,
      signal,
    });
    return data;
  } catch (err) {
    normalise(err);
  }
}

// ─── History endpoints ────────────────────────────────────────────────────────

export async function getHistory(
  sessionId: string,
  signal?: AbortSignal,
): Promise<HistoryItem[]> {
  try {
    const { data } = await client.get<HistoryItem[]>(`/history/${sessionId}`, { signal });
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

// ─── Health endpoints ─────────────────────────────────────────────────────────

export async function getHealth(signal?: AbortSignal): Promise<{ status: string }> {
  try {
    const { data } = await client.get<{ status: string }>('/health', { signal });
    return data;
  } catch (err) {
    normalise(err);
  }
}

export async function getHealthReady(signal?: AbortSignal): Promise<HealthReady> {
  try {
    const { data } = await client.get<HealthReady>('/health/ready', { signal });
    return data;
  } catch (err) {
    normalise(err);
  }
}
