/**
 * useChat – manages a single chat session.
 *
 * Responsibilities:
 *  - Maintain the local message list (user + assistant turns)
 *  - Send questions to POST /chat or POST /agent/chat
 *  - Load previous history from GET /history/{session_id} on mount
 *  - Clear conversation via DELETE /history/{session_id} + rotate session id
 *  - Track loading / error state
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as api from '@/services/api';
import {
  getOrCreateSessionId,
  rotateSessionId,
} from '@/utils/session';
import type { ChatMessage, ChatMode } from '@/types';

export interface UseChatOptions {
  /** Restrict answers to one document. Pass undefined for all documents. */
  docId?: string;
  /** 'rag' = plain RAG, 'agent' = tool-using agent */
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>(getOrCreateSessionId);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | undefined>(options.docId);
  const [activeMode, setActiveMode] = useState<ChatMode>(options.mode ?? 'rag');

  // Keep a ref so async callbacks always see the latest sessionId
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  /** Hydrate messages from server history on mount */
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const items = await api.getHistory(sessionId);
        if (cancelled) return;
        const msgs: ChatMessage[] = items.map((item) => ({
          id: uuidv4(),
          role: item.role,
          content: item.content,
          sources: item.sources ?? [],
          timestamp: new Date(item.created_at),
        }));
        setMessages(msgs);
      } catch {
        // History load failure is non-critical – start fresh
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [sessionId]);

  const sendMessage = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    setError(null);

    // Optimistically add the user message
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    try {
      const req = {
        session_id: sessionIdRef.current,
        question: trimmed,
        doc_id: activeDocId,
      };

      const resp =
        activeMode === 'agent'
          ? await api.sendAgentChat(req)
          : await api.sendChat(req);

      const aiMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: resp.answer,
        sources: resp.sources,
        tools_used: resp.tools_used,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
      // Add an error message into the chat so the user sees it inline
      const errMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `⚠️ ${msg}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setThinking(false);
    }
  }, [activeDocId, activeMode]);

  const clearConversation = useCallback(async () => {
    try {
      await api.clearHistory(sessionIdRef.current);
    } catch {
      // Ignore – even if the server clear fails, reset the local UI
    }
    const newId = rotateSessionId();
    setSessionId(newId);
    setMessages([]);
    setError(null);
  }, []);

  const setDocId = useCallback((id: string | undefined) => {
    setActiveDocId(id);
  }, []);

  const setMode = useCallback((mode: ChatMode) => {
    setActiveMode(mode);
  }, []);

  return {
    messages,
    sessionId,
    thinking,
    error,
    sendMessage,
    clearConversation,
    setDocId,
    setMode,
    activeDocId,
    activeMode,
  };
}
