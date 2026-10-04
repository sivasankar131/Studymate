// ─── Backend response shapes (match FastAPI exactly) ────────────────────────

/** Returned by POST /upload and GET /documents */
export interface Document {
  id: string;
  filename: string;
  num_pages: number;
  num_chunks: number;
  created_at: string; // ISO-8601
}

/** One citation item inside a chat response */
export interface Source {
  type?: string;
  file?: string;
  page?: number;
  snippet?: string;
  /** agent-mode tools may return arbitrary extra keys */
  [key: string]: unknown;
}

/** POST /chat  and  POST /agent/chat  request */
export interface ChatRequest {
  session_id: string;
  question: string;
  doc_id?: string;
}

/** POST /chat  and  POST /agent/chat  response */
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

/** A message shown inside the chat window */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  tools_used?: string[];
  timestamp: Date;
  isStreaming?: boolean;
}

/** Upload slot tracked in the UI (before / during / after upload) */
export type UploadStatus = 'pending' | 'uploading' | 'processing' | 'done' | 'error';

export interface UploadFile {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
  /** Set once the backend responds successfully */
  document?: Document;
  progress?: number;
}

/** Chat mode the user has selected */
export type ChatMode = 'rag' | 'agent';

/** Sidebar navigation items */
export type NavPage = 'home' | 'chat' | 'documents' | 'settings';
