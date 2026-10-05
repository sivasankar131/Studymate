// ─── Backend response shapes (match FastAPI exactly) ────────────────────────

export type DocumentStatus = 'queued' | 'processing' | 'indexing' | 'ready' | 'failed';

/** Returned by POST /upload, GET /documents, GET /documents/{id}/status */
export interface Document {
  id: string;
  filename: string;
  num_pages: number;
  num_chunks: number;
  created_at: string;       // ISO-8601
  updated_at: string;       // ISO-8601
  status: DocumentStatus;
  progress: number;         // 0–100
  error_message: string | null;
}

/** Lightweight shape returned by GET /documents/{id}/status */
export interface DocumentStatusResponse {
  id: string;
  filename: string;
  status: DocumentStatus;
  progress: number;
  num_pages: number;
  num_chunks: number;
  error_message: string | null;
}

/** One citation item inside a chat response */
export interface Source {
  type?: string;
  file?: string;
  page?: number;
  snippet?: string;
  [key: string]: unknown;
}

/** POST /chat and POST /agent/chat request */
export interface ChatRequest {
  session_id: string;
  question: string;
  doc_id?: string;
}

/** POST /chat and POST /agent/chat response */
export interface ChatResponse {
  answer: string;
  sources: Source[];
  tools_used: string[];
}

/** One item in GET /history/:session_id */
export interface HistoryItem {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[] | null;
  created_at: string;
}

/** GET /health/ready */
export interface HealthReady {
  status: 'ok' | 'degraded';
  database: string;
  vector_store: string;
}

// ─── Frontend-only shapes ────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  tools_used?: string[];
  timestamp: Date;
  isStreaming?: boolean;
}

/**
 * Upload slot tracked in the UI.
 * status mirrors backend DocumentStatus plus 'pending' (not yet submitted)
 * and 'uploading' (bytes in flight to the server).
 */
export type UploadStatus =
  | 'pending'      // waiting in the queue, not yet submitted
  | 'uploading'    // bytes being transferred to the server
  | 'queued'       // server accepted the file, ingestion not started yet
  | 'processing'   // PDF extraction + chunking
  | 'indexing'     // embedding + Qdrant insertion
  | 'done'         // ready (maps to backend 'ready')
  | 'error';       // failed

export interface UploadFile {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
  /** Set once the backend POST /upload responds */
  documentId?: string;
  document?: Document;
  progress?: number;
}

export type ChatMode = 'rag' | 'agent';
export type NavPage = 'home' | 'chat' | 'documents' | 'settings';
