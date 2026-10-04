import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '@/components/ChatMessage';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { EmptyState } from '@/components/EmptyState';
import type { ChatMessage as ChatMessageType } from '@/types';

interface Props {
  messages: ChatMessageType[];
  thinking: boolean;
  activeDocName?: string;
  onClearFilter?: () => void;
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3 animate-[slideUp_0.3s_ease-out]">
      <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center">
        <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.5 1L3 9h5l-1.5 6L14 7H9L9.5 1z"/>
        </svg>
      </div>
      <div className="flex flex-col gap-1 items-start">
        <span className="text-[11px] font-semibold text-accent-600 px-1">StudyMate AI</span>
        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-surface-200 shadow-sm">
          <LoadingIndicator variant="dots" label="Thinking…" size="md"/>
        </div>
      </div>
    </div>
  );
}

/** Empty chat illustration */
const ChatEmptyIcon = () => (
  <svg className="w-14 h-14 text-surface-300" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 8h32a2 2 0 012 2v20a2 2 0 01-2 2H14l-6 6V10a2 2 0 012-2z"/>
    <circle cx="18" cy="20" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="24" cy="20" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="30" cy="20" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
);

export const ChatWindow: React.FC<Props> = ({ messages, thinking, activeDocName, onClearFilter }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 scroll-smooth bg-surface-100" role="log" aria-live="polite">
      {/* Document filter chip */}
      {activeDocName && (
        <div className="sticky top-0 z-10 flex items-center justify-center mb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-brand-200 text-xs text-brand-700 shadow-sm">
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h10l-4 5v4l-2-1V8L2 3z"/>
            </svg>
            <span>Filtering: <strong>{activeDocName}</strong></span>
            {onClearFilter && (
              <button onClick={onClearFilter} className="ml-1 text-surface-400 hover:text-surface-700 transition-colors" title="Remove filter">
                <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {messages.length === 0 && !thinking && (
        <EmptyState
          icon={<ChatEmptyIcon/>}
          title="Start a conversation"
          description={activeDocName
            ? `Ask anything about "${activeDocName}".`
            : 'Upload a document then ask questions. Every answer includes the source page.'
          }
          className="h-full"
        />
      )}

      {messages.map(msg => <ChatMessage key={msg.id} message={msg}/>)}
      {thinking && <ThinkingBubble/>}
      <div ref={bottomRef} aria-hidden="true"/>
    </div>
  );
};

export default ChatWindow;
