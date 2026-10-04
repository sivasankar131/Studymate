import React, { useState } from 'react';
import { SourceCard } from '@/components/SourceCard';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import type { ChatMessage as ChatMessageType } from '@/types';

interface Props { message: ChatMessageType; }

function renderContent(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i, arr) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={j} className="font-semibold text-surface-900">{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={j} className="px-1.5 py-0.5 rounded bg-surface-100 text-brand-700 text-[0.85em] font-mono border border-surface-200">{part.slice(1, -1)}</code>;
      return <span key={j}>{part}</span>;
    });
    return <span key={i}>{parts}{i < arr.length - 1 && <br />}</span>;
  });
}

/** User avatar – initials in a circle */
const UserAvatar = () => (
  <div className="shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold select-none" aria-hidden="true">
    U
  </div>
);

/** AI avatar – geometric spark mark */
const AIAvatar = () => (
  <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center select-none" aria-hidden="true">
    <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="currentColor">
      {/* Lightning bolt */}
      <path d="M9.5 1L3 9h5l-1.5 6L14 7H9L9.5 1z"/>
    </svg>
  </div>
);

export const ChatMessage: React.FC<Props> = ({ message }) => {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const isUser     = message.role === 'user';
  const isThinking = message.isStreaming;
  const hasSources = (message.sources?.length ?? 0) > 0;
  const hasTools   = (message.tools_used?.length ?? 0) > 0;

  return (
    <div className={`flex gap-3 animate-[slideUp_0.3s_ease-out] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      aria-label={isUser ? 'Your message' : 'AI response'}>

      {isUser ? <UserAvatar /> : <AIAvatar />}

      <div className={`flex flex-col gap-1.5 max-w-[85%] sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <span className={`text-[11px] font-semibold px-1 ${isUser ? 'text-brand-600' : 'text-accent-600'}`}>
          {isUser ? 'You' : 'StudyMate AI'}
        </span>

        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm
          ${isUser
            ? 'bg-brand-600 text-white rounded-tr-sm'
            : 'bg-white border border-surface-200 text-surface-800 rounded-tl-sm'
          }`}>
          {isThinking
            ? <LoadingIndicator variant="dots" label="Thinking…" size="md"/>
            : <p className="whitespace-pre-wrap break-words">{renderContent(message.content)}</p>
          }
        </div>

        {/* Tools used – agent mode */}
        {hasTools && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {message.tools_used!.map(tool => (
              <span key={tool} className="text-[10px] px-2 py-0.5 rounded-full bg-accent-50 border border-accent-200 text-accent-700 font-mono flex items-center gap-1">
                {/* Wrench icon */}
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
                  <path d="M7.5 1a2 2 0 01.5 3.5L4 9 1 6l4-4a2 2 0 012.5-.5z"/>
                </svg>
                {tool}
              </span>
            ))}
          </div>
        )}

        {/* Sources */}
        {hasSources && !isThinking && (
          <div className="w-full px-1">
            <button
              onClick={() => setSourcesExpanded(v => !v)}
              className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-brand-600 transition-colors mb-2"
              aria-expanded={sourcesExpanded}
            >
              {/* Chevron rotates */}
              <svg className={`w-3.5 h-3.5 transition-transform ${sourcesExpanded ? 'rotate-90' : ''}`}
                viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <polyline points="4,2 8,6 4,10"/>
              </svg>
              <span className="border-b border-dashed border-surface-300 hover:border-brand-400">
                {sourcesExpanded ? 'Hide' : 'View'} {message.sources!.length} {message.sources!.length === 1 ? 'source' : 'sources'}
              </span>
            </button>
            {sourcesExpanded && (
              <div className="space-y-2 animate-[fadeIn_0.2s_ease-in-out]">
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-px flex-1 bg-surface-200"/>
                  <span className="text-[9px] text-surface-400 uppercase tracking-widest font-semibold">Sources</span>
                  <div className="h-px flex-1 bg-surface-200"/>
                </div>
                {message.sources!.map((src, i) => <SourceCard key={i} source={src} index={i}/>)}
              </div>
            )}
          </div>
        )}

        <span className="text-[10px] text-surface-300 px-1">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
};

export default ChatMessage;
