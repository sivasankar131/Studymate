/**
 * Centralized API service for StudyMate.
 *
 * Every request automatically carries:
 *   X-Client-ID: <stable browser UUID from localStorage>
 *
 * Cold-start / Render wake-up
 * ───────────────────────────
 * The backend runs on Render's free tier which spins down after inactivity.
 * The first request after idle can take 30–90 s to respond.
 *
 * ensureBackendReady() handles this:
 *   - polls GET /health with a 90s per-attempt timeout
 *   - shows the "waking up" state to the caller
 *   - caches the "ready" result for the browser session
 *   - subsequent calls return immediately once the backend is confirmed alive
 *
 * Cancellation contract
 * ─────────────────────
 * Axios cancel (ERR_CANCELED / CanceledError / AbortError) → CancelledError.
 * Callers: if (isCancelledError(err)) return;  // silent lifecycle event
 *
 * Retry contract
 * ──────────────
 * requestWithRetry() retries on transient failures (network, 502/503/504).
 * It does NOT retry 4xx (client errors) or intentional cancellations.
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

export class CancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'CancelledError';
  }
}

export function isCancelledError(err: unknown): err is CancelledError {
  if (err instanceof CancelledError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error) {
    if (err.name === 'CanceledError') return true;
    if (err.name === 'AbortError')    return true;
  }
  if (axios.isAxiosError(err)) {
    if ((err as AxiosError).code === 'ERR_CANCELED') return true;
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
  if (isCancelledError(err)) throw new CancelledError();

  if (axios.isAxiosError(err)) {
    const ae     = err as AxiosError;
    const status = ae.response?.status ?? 0;
    const detail = extractDetail(ae.response?.data) ?? '';

    if (status === 0 || ae.code === 'ECONNABORTED' || ae.code === 'ERR_NETWORK') {
      throw new ApiError(0, "Can't reach the StudyMate server. Please check your connection or try again.");
    }
    if (ae.code === 'ETIMEDOUT' || status === 524 || status === 408) {
      throw new ApiError(status, 'The StudyMate server is taking too long to respond. It may be starting up — please try again.');
    }
    if (status === 400) throw new ApiError(status, detail || 'Bad request.');
    if (status === 404) throw new ApiError(status, detail || 'Resource not found.');
    if (status === 413) throw new ApiError(status, detail || 'File is too large. Maximum size is 10 MB.');
    if (status === 422) throw new ApiError(status, detail || 'Could not process this file.');
    if (status === 429) throw new ApiError(status, detail || 'The AI service is rate-limited. Please wait a moment.');
    if (status === 500) throw new ApiError(status, detail || 'StudyMate encountered a server error. Please try again.');
    if (status === 502) throw new ApiError(status, detail || 'Backend is temporarily unavailable (502). Please try again.');
    if (status === 503) throw new ApiError(status, detail || 'The StudyMate server is starting up. Please wait a moment.');
    if (status === 504) throw new ApiError(status, detail || 'The server timed out. Please try again.');
    throw new ApiError(status, detail || `Unexpected error (${status}).`);
  }
  if (err instanceof Error) throw new ApiError(0, err.message);
  throw new ApiError(0, 'An unexpected error occurred.');
}

// ─── Cold-start / wake-up ─────────────────────────────────────────────────────

/** Cached per browser-session — once we know the backend is alive we stop pinging it */
let _backendReady = false;
let _readyPromise: Promise<void> | null = null;

export type WakeupCallback = (state: 'checking' | 'waking' | 'ready') => void;

/**
 * Ensures the backend is reachable before sending a real request.
 *
 * Strategy:
 *  - If the backend was confirmed alive this session, resolves immediately.
 *  - Otherwise polls GET /health with a 90 s timeout, invoking onState so
 *    the UI can show "Checking…" → "Waking up…" → "Ready".
 *  - Deduplicates: concurrent callers share the same promise.
 *
 * onState is optional — pass it to drive waking-up UI feedback.
 */
export function ensureBackendReady(
  onState?: WakeupCallback,
  signal?: AbortSignal,
): Promise<void> {
  if (_backendReady) return Promise.resolve();

  // Deduplicate — all concurrent callers wait on the same promise
  if (_readyPromise) return _readyPromise;

  _readyPromise = (async () => {
    onState?.('checking');
    const HEALTH_TIMEOUT = 90_000;   // 90 s — generous enough for Render cold start
    const POLL_INTERVAL  =  5_000;   // retry health check every 5 s
    const started = Date.now();

    while (Date.now() - started < HEALTH_TIMEOUT) {
      if (signal?.aborted) throw new CancelledError();

      try {
        await client.get('/health', { timeout: 10_000, signal });
        _backendReady = true;
        onState?.('ready');
        return;
      } catch (err) {
        if (isCancelledError(err) || signal?.aborted) throw new CancelledError();
        // Backend not yet up — show "waking" UI and wait before next attempt
        const elapsed = Date.now() - started;
        if (elapsed > 3_000) onState?.('waking');   // only after 3 s to avoid flicker
      }

      // Wait before next poll (but bail if signal is aborted mid-wait)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, POLL_INTERVAL);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new CancelledError()); });
      });
    }

    // Exhausted timeout — let the actual request fail with a real error
    _backendReady = false;
    _readyPromise = null;
    throw new ApiError(0, 'The StudyMate server is taking longer than expected to start. Please try again in a moment.');
  })().catch(err => {
    // Reset so the next call tries again
    _readyPromise = null;
    throw err;
  });

  return _readyPromise;
}

/** Reset the readiness cache (useful after a confirmed backend error) */
export function resetBackendReady(): void {
  _backendReady = false;
  _readyPromise = null;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

/** Statuses that are worth retrying (transient server/network problems) */
function isRetryable(err: unknown): boolean {
  if (isCancelledError(err)) return false;   // intentional — never retry
  if (err instanceof ApiError) {
    const s = err.status;
    // Retry: network failure (0), gateway errors, service unavailable, timeout
    return s === 0 || s === 502 || s === 503 || s === 504 || s === 429;
  }
  return false;
}

const RETRY_DELAYS = [5_000, 15_000] as const;  // 2 retries: wait 5 s then 15 s

async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, delay: number) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === RETRY_DELAYS.length) break;
      const delay = RETRY_DELAYS[attempt];
      onRetry?.(attempt + 1, delay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
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
      `/documents/${docId}/status`, { signal },
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

// ─── Chat endpoints (with retry) ─────────────────────────────────────────────

export async function sendChat(
  req: ChatRequest,
  signal?: AbortSignal,
  onRetry?: (attempt: number, delay: number) => void,
): Promise<ChatResponse> {
  return withRetry(async () => {
    try {
      const { data } = await client.post<ChatResponse>('/chat', req, {
        timeout: 120_000,   // 2 min — covers cold start + RAG + LLM
        signal,
      });
      return data;
    } catch (err) {
      normalise(err);
    }
  }, onRetry);
}

export async function sendAgentChat(
  req: ChatRequest,
  signal?: AbortSignal,
  onRetry?: (attempt: number, delay: number) => void,
): Promise<ChatResponse> {
  return withRetry(async () => {
    try {
      const { data } = await client.post<ChatResponse>('/agent/chat', req, {
        timeout: 120_000,
        signal,
      });
      return data;
    } catch (err) {
      normalise(err);
    }
  }, onRetry);
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
    // Generous timeout — this is the cold-start probe in useHealth
    const { data } = await client.get<HealthReady>('/health/ready', {
      timeout: 90_000,
      signal,
    });
    return data;
  } catch (err) {
    normalise(err);
  }
}
