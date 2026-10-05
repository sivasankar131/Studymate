/**
 * useChat – manages a single chat session.
 *
 * Cold-start / wake-up
 * ─────────────────────
 * Before the first chat request each session, ensureBackendReady() confirms
 * the backend is reachable (with a generous 90 s timeout that tolerates
 * Render free-tier cold starts).  While waiting, `wakeState` exposes the
 * current stage so the UI can show "Checking…" / "Waking up server…".
 *
 * Retry
 * ─────
 * sendChat / sendAgentChat use withRetry internally (2 attempts, 5 s / 15 s
 * delays) for transient network/502/503 failures.  The `retryInfo` state lets
 * the UI show "Retrying automatically…".
 *
 * State isolation
 * ───────────────
 * Chat error state is completely independent of document / health / upload
 * errors.  A cancelled documents request can never set chatError.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as api from '@/services/api';
import {
  ensureBackendReady,
  isCancelledError,
  type WakeupCallback,
} from '@/services/api';
import { getOrCreateSessionId, rotateSessionId } from '@/utils/session';
import type { ChatMessage, ChatMode } from '@/types';

export type WakeState = 'idle' | 'checking' | 'waking' | 'ready';

export interface UseChatOptions {
  docId?: string;
  mode?: ChatMode;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  sessionId: string;
  thinking: boolean;
  wakeState: WakeState;
  retryInfo: string | null;   // e.g. "Retrying automatically (1/2)…"
  error: string | null;
  sendMessage: (question: string) => Promise<void>;
  clearConversation: () => Promise<void>;
  setDocId: (id: string | undefined) => void;
  setMode: (mode: ChatMode) => void;
  activeDocId: string | undefined;
  activeMode: ChatMode;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>(getOrCreateSessionId);
  const [thinking, setThinking]   = useState(false);
  const [wakeState, setWakeState] = useState<WakeState>('idle');
  const [retryInfo, setRetryInfo] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | undefined>(options.docId);
  const [activeMode, setActiveMode]   = useState<ChatMode>(options.mode ?? 'rag');

  const sessionIdRef = useRef(sessionId);
  const isMounted    = useRef(true);
  const chatAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (chatAbortRef.current) chatAbortRef.current.abort();
    };
  }, []);

  // ── History hydration ─────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      try {
        const items = await api.getHistory(sessionId, controller.signal);
        if (controller.signal.aborted || !isMounted.current) return;
        setMessages(items.map(item => ({
          id:        uuidv4(),
          role:      item.role,
          content:   item.content,
          sources:   item.sources ?? [],
          timestamp: new Date(item.created_at),
        })));
      } catch (err) {
        if (isCancelledError(err) || controller.signal.aborted) return;
        // History load failure is non-critical — start fresh
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [sessionId]);

  // ── sendMessage ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    setError(null);
    setRetryInfo(null);

    const userMsg: ChatMessage = {
      id:        uuidv4(),
      role:      'user',
      content:   trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);
    setWakeState('idle');

    // Abort any previous in-flight request
    if (chatAbortRef.current) chatAbortRef.current.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      // ── Step 1: ensure backend is awake ───────────────────────────────────
      const onWake: WakeupCallback = state => {
        if (!isMounted.current || controller.signal.aborted) return;
        setWakeState(state);
      };

      await ensureBackendReady(onWake, controller.signal);

      if (controller.signal.aborted || !isMounted.current) return;
      setWakeState('idle');

      // ── Step 2: send the chat request (with retry) ────────────────────────
      const req = {
        session_id: sessionIdRef.current,
        question:   trimmed,
        doc_id:     activeDocId,
      };

      const onRetry = (attempt: number, delay: number) => {
        if (!isMounted.current || controller.signal.aborted) return;
        setRetryInfo(`Retrying automatically (${attempt}/2) in ${delay / 1000}s…`);
      };

      const resp = activeMode === 'agent'
        ? await api.sendAgentChat(req, controller.signal, onRetry)
        : await api.sendChat(req, controller.signal, onRetry);

      if (controller.signal.aborted || !isMounted.current) return;

      setRetryInfo(null);
      setMessages(prev => [...prev, {
        id:         uuidv4(),
        role:       'assistant',
        content:    resp.answer,
        sources:    resp.sources,
        tools_used: resp.tools_used,
        timestamp:  new Date(),
      }]);
    } catch (err) {
      if (isCancelledError(err) || controller.signal.aborted) return;
      if (!isMounted.current) return;

      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
      setRetryInfo(null);
      setMessages(prev => [...prev, {
        id:        uuidv4(),
        role:      'assistant',
        content:   `⚠️ ${msg}`,
        timestamp: new Date(),
      }]);
    } finally {
      if (isMounted.current) {
        setThinking(false);
        setWakeState('idle');
      }
    }
  }, [activeDocId, activeMode]);

  // ── clearConversation ─────────────────────────────────────────────────────
  const clearConversation = useCallback(async () => {
    try { await api.clearHistory(sessionIdRef.current); } catch { /* non-critical */ }
    const newId = rotateSessionId();
    setSessionId(newId);
    setMessages([]);
    setError(null);
    setRetryInfo(null);
    setWakeState('idle');
  }, []);

  const setDocId = useCallback((id: string | undefined) => setActiveDocId(id), []);
  const setMode  = useCallback((mode: ChatMode) => setActiveMode(mode), []);

  return {
    messages, sessionId, thinking, wakeState, retryInfo, error,
    sendMessage, clearConversation,
    setDocId, setMode, activeDocId, activeMode,
  };
}
