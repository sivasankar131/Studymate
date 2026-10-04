import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMode } from '@/types';

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  thinking?: boolean;
  placeholder?: string;
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  onClear?: () => void;
  className?: string;
}

const MAX_CHARS = 2000;

export const MessageInput: React.FC<Props> = ({
  onSend, disabled = false, thinking = false,
  placeholder = 'Ask anything about your documents…',
  mode = 'rag', onModeChange, onClear, className = '',
}) => {
  const [value, setValue]   = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const canSend  = value.trim().length > 0 && !disabled && !thinking;
  const remaining = MAX_CHARS - value.length;
  const nearLimit = remaining < 200;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [canSend, onSend, value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className={`px-4 pb-4 pt-2 bg-white border-t border-surface-200 ${className}`}>
      {/* Toolbar row */}
      {(onModeChange || onClear) && (
        <div className="flex items-center justify-between mb-2 px-1">
          {onModeChange && (
            <div className="flex items-center gap-0.5 bg-surface-100 rounded-lg p-0.5 border border-surface-200">
              {(['rag', 'agent'] as ChatMode[]).map(m => (
                <button key={m} onClick={() => onModeChange(m)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150
                    ${mode === m ? 'bg-white text-brand-700 shadow-sm border border-surface-200' : 'text-surface-400 hover:text-surface-700'}`}
                  title={m === 'rag' ? 'RAG – retrieve from your documents' : 'Agent – multi-step reasoning with tools'}>
                  {m === 'rag' ? (
                    <span className="flex items-center gap-1">
                      {/* Stack of pages */}
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                        <rect x="2" y="3" width="8" height="7" rx="1"/>
                        <line x1="2" y1="2" x2="10" y2="2"/>
                      </svg>
                      RAG
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      {/* Lightning bolt */}
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M7 1L2.5 7H6L5 11l5-6H7.5L7 1z"/>
                      </svg>
                      Agent
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {onClear && (
            <button onClick={onClear}
              className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-700 transition-colors px-2 py-1 rounded-lg hover:bg-surface-100">
              {/* Bin icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2,3.5 12,3.5"/>
                <path d="M4 3.5V2.5a1 1 0 011-1h4a1 1 0 011 1v1"/>
                <path d="M5.5 6.5v4M8.5 6.5v4"/>
                <path d="M3 3.5l.7 8a1 1 0 001 .9h4.6a1 1 0 001-.9l.7-8"/>
              </svg>
              Clear chat
            </button>
          )}
        </div>
      )}

      {/* Input box */}
      <div className={`relative flex items-end gap-2 rounded-2xl border transition-all duration-200
        ${focused && !disabled
          ? 'border-brand-400 bg-white shadow-glow-sm ring-2 ring-brand-100'
          : disabled ? 'border-surface-200 bg-surface-100 opacity-60 cursor-not-allowed'
          : 'border-surface-300 bg-white hover:border-surface-400'
        }`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => e.target.value.length <= MAX_CHARS && setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled || thinking}
          placeholder={thinking ? 'StudyMate is thinking…' : placeholder}
          rows={1}
          aria-label="Message input"
          className={`flex-1 resize-none bg-transparent text-sm text-surface-800 placeholder:text-surface-400
            px-4 py-3 focus:outline-none leading-relaxed min-h-[44px] max-h-[160px]
            ${disabled || thinking ? 'cursor-not-allowed' : ''}`}
          style={{ scrollbarWidth: 'thin' }}
        />
        <div className="flex items-center gap-1.5 pr-2 pb-2">
          {nearLimit && value.length > 0 && (
            <span className={`text-[10px] font-mono ${remaining < 50 ? 'text-red-500' : 'text-amber-500'}`}>
              {remaining}
            </span>
          )}
          <button onClick={handleSend} disabled={!canSend} aria-label="Send message" title="Send (Enter)"
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150
              ${canSend ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-sm' : 'bg-surface-100 text-surface-300 cursor-not-allowed border border-surface-200'}`}>
            {thinking ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              /* Paper plane send icon */
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2L1 7l5 2 2 5 6-12z"/>
                <line x1="6" y1="9" x2="10" y2="5"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-surface-300 mt-1.5 px-1">
        <kbd className="px-1 py-0.5 rounded bg-surface-100 border border-surface-200 text-surface-400 font-mono text-[10px]">Enter</kbd> send
        &nbsp;·&nbsp;
        <kbd className="px-1 py-0.5 rounded bg-surface-100 border border-surface-200 text-surface-400 font-mono text-[10px]">Shift+Enter</kbd> new line
      </p>
    </div>
  );
};

export default MessageInput;
