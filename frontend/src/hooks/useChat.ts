/**
 * useChat – manages a single chat session.
 *
 * State isolation: chat error state is completely independent of
 * document loading, upload, or health errors.  A cancelled documents
 * request can never set chatError.
 *
 * Cancellation:
 *  - sendMessage() creates an AbortController per request.
 *    If the component unmounts mid-request the error is silently ignored.
 *  - History load on mount is also cancellation-aware.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as api from '@/services/api';
import { isCancelledError } from '@/services/api';
import { getOrCreateSessionId, rotateSessionId } from '@/utils/session';
import type { ChatMessage, ChatMode } from '@/types';

export interface UseChatOptions {
  docId?: string;
  mode?: ChatMode;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  sessionId: string;
  thinking: boolean;
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
  const [error, setError]         = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | undefined>(options.docId);
  const [activeMode, setActiveMode]   = useState<ChatMode>(options.mode ?? 'rag');

  const sessionIdRef  = useRef(sessionId);
  const isMounted     = useRef(true);
  // Abort controller for the current in-flight sendMessage request
  const chatAbortRef  = useRef<AbortController | null>(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Abort any in-flight chat request when navigating away
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
        // Cancelled (unmount) or network — both non-critical for history
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

    const userMsg: ChatMessage = {
      id:        uuidv4(),
      role:      'user',
      content:   trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    // Abort any previous request still in flight
    if (chatAbortRef.current) chatAbortRef.current.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      const req = {
        session_id: sessionIdRef.current,
        question:   trimmed,
        doc_id:     activeDocId,
      };

      const resp = activeMode === 'agent'
        ? await api.sendAgentChat(req, controller.signal)
        : await api.sendChat(req, controller.signal);

      // If cancelled (user navigated away mid-request) — drop silently
      if (controller.signal.aborted || !isMounted.current) return;

      setMessages(prev => [...prev, {
        id:         uuidv4(),
        role:       'assistant',
        content:    resp.answer,
        sources:    resp.sources,
        tools_used: resp.tools_used,
        timestamp:  new Date(),
      }]);
    } catch (err) {
      // Cancelled — silently discard (user navigated away)
      if (isCancelledError(err) || controller.signal.aborted) return;
      if (!isMounted.current) return;

      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
      setMessages(prev => [...prev, {
        id:        uuidv4(),
        role:      'assistant',
        content:   `⚠️ ${msg}`,
        timestamp: new Date(),
      }]);
    } finally {
      if (isMounted.current) setThinking(false);
    }
  }, [activeDocId, activeMode]);

  // ── clearConversation ─────────────────────────────────────────────────────
  const clearConversation = useCallback(async () => {
    try {
      await api.clearHistory(sessionIdRef.current);
    } catch {
      // Non-critical — clear local UI regardless
    }
    const newId = rotateSessionId();
    setSessionId(newId);
    setMessages([]);
    setError(null);
  }, []);

  const setDocId = useCallback((id: string | undefined) => setActiveDocId(id), []);
  const setMode  = useCallback((mode: ChatMode) => setActiveMode(mode), []);

  return {
    messages, sessionId, thinking, error,
    sendMessage, clearConversation,
    setDocId, setMode, activeDocId, activeMode,
  };
}
