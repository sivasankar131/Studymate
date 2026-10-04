import React from 'react';

interface Props {
  message: string;
  title?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  variant?: 'inline' | 'banner' | 'toast';
  className?: string;
}

export const ErrorMessage: React.FC<Props> = ({
  message, title, onDismiss, onRetry, variant = 'inline', className = '',
}) => {
  if (variant === 'banner') {
    return (
      <div role="alert" className={`flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 ${className}`}>
        <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
        </svg>
        <div className="flex-1 min-w-0">
          {title && <p className="font-semibold text-red-800 mb-0.5 text-sm">{title}</p>}
          <p className="text-sm leading-relaxed">{message}</p>
          {onRetry && (
            <button onClick={onRetry} className="mt-2 text-xs font-medium text-red-600 hover:text-red-800 underline underline-offset-2 transition-colors">
              Try again
            </button>
          )}
        </div>
        {onDismiss && (
          <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-red-400 hover:text-red-600 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
              <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
            </svg>
          </button>
        )}
      </div>
    );
  }

  if (variant === 'toast') {
    return (
      <div role="alert" className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm shadow ${className}`}>
        <svg className="w-4 h-4 text-red-400" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="7" fill="#fee2e2" stroke="#fca5a5" strokeWidth="1"/>
          <line x1="8" y1="5" x2="8" y2="9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="8" cy="11.5" r="0.75" fill="#ef4444"/>
        </svg>
        <span>{message}</span>
        {onDismiss && <button onClick={onDismiss} className="ml-1 text-red-400 hover:text-red-600">×</button>}
      </div>
    );
  }

  return (
    <p role="alert" className={`text-sm text-red-600 flex items-center gap-1.5 ${className}`}>
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="7" fill="#fee2e2" stroke="#fca5a5" strokeWidth="1"/>
        <line x1="8" y1="5" x2="8" y2="9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.75" fill="#ef4444"/>
      </svg>
      {message}
    </p>
  );
};

export default ErrorMessage;
