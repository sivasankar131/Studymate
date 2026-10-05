import React from 'react';

interface Props {
  variant?: 'dots' | 'spinner' | 'bar';
  label?: string;
  progress?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: { dot: 'w-1.5 h-1.5', spinner: 'w-4 h-4', text: 'text-xs font-semibold' },
  md: { dot: 'w-2 h-2',     spinner: 'w-5 h-5', text: 'text-sm font-semibold' },
  lg: { dot: 'w-2.5 h-2.5', spinner: 'w-6 h-6', text: 'text-base font-semibold' },
};

export const LoadingIndicator: React.FC<Props> = ({
  variant = 'dots', label, progress, size = 'md', className = '',
}) => {
  const s = sizeMap[size];

  if (variant === 'spinner') {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <svg className={`${s.spinner} animate-spin text-brand-600`}
          xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {label && <span className={`${s.text} text-surface-700`}>{label}</span>}
      </span>
    );
  }

  if (variant === 'bar') {
    return (
      <div className={`w-full ${className}`}>
        {label && (
          <div className="flex justify-between mb-1">
            <span className={`${s.text} text-surface-700`}>{label}</span>
            {progress !== undefined && (
              <span className={`${s.text} text-brand-700 font-mono`}>{progress}%</span>
            )}
          </div>
        )}
        <div className="w-full bg-surface-200 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full transition-all duration-300"
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}
      role="status" aria-label={label ?? 'Loading'}>
      <span className="flex gap-1">
        {[0, 1, 2].map(i => (
          <span key={i} className={`${s.dot} rounded-full bg-brand-600`}
            style={{ animation: `bounceDot 1.4s ${i * 0.16}s infinite ease-in-out both` }} />
        ))}
      </span>
      {label && <span className={`${s.text} text-surface-700`}>{label}</span>}
    </span>
  );
};

export default LoadingIndicator;
