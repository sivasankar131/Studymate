import React from 'react';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { formatBytes, fileExtLabel } from '@/utils/format';
import type { UploadFile } from '@/types';

interface Props { item: UploadFile; onRemove: (id: string) => void; onRetry: (id: string) => void; }

const statusConfig = {
  pending:    { label: 'Ready to upload', color: 'text-surface-500', bg: 'bg-white border-surface-200' },
  uploading:  { label: 'Uploading…',      color: 'text-brand-600',   bg: 'bg-brand-50 border-brand-200' },
  processing: { label: 'Processing…',     color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200' },
  done:       { label: 'Completed',        color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  error:      { label: 'Failed',           color: 'text-red-600',     bg: 'bg-red-50 border-red-200' },
} as const;

export const FileCard: React.FC<Props> = ({ item, onRemove, onRetry }) => {
  const { file, status, error, progress } = item;
  const cfg = statusConfig[status];
  const ext = fileExtLabel(file.name);
  const isActive = status === 'uploading' || status === 'processing';

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border transition-all duration-200 ${cfg.bg}`}>
      {/* Type badge */}
      <div className="shrink-0 w-10 h-10 rounded-lg bg-white border border-surface-200 flex flex-col items-center justify-center shadow-sm">
        <svg className="w-5 h-5 text-surface-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14h10a1 1 0 001-1V5l-3-3H3a1 1 0 00-1 1v10a1 1 0 001 1z"/>
          <path d="M11 2v3h3"/>
        </svg>
        <span className="text-[8px] font-bold text-brand-600 leading-none">{ext}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-surface-800 truncate" title={file.name}>{file.name}</p>
        <p className="text-xs text-surface-400 mt-0.5">{formatBytes(file.size)}</p>

        <div className={`flex items-center gap-2 mt-1.5 ${cfg.color}`}>
          {isActive ? <LoadingIndicator variant="dots" size="sm" /> : <span className="text-xs">{cfg.label}</span>}
          {isActive && <span className="text-xs">{cfg.label}</span>}
        </div>

        {isActive && progress !== undefined && (
          <div className="mt-2 w-full bg-surface-200 rounded-full h-1 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full transition-all duration-300"
              style={{ width: `${status === 'processing' ? Math.max(progress, 50) : progress}%` }}/>
          </div>
        )}

        {status === 'error' && error && (
          <p className="mt-1.5 text-xs text-red-500 leading-relaxed">{error}</p>
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-1">
        {status === 'error' && (
          <button onClick={() => onRetry(item.id)} title="Retry" className="w-7 h-7 rounded-md flex items-center justify-center text-amber-500 hover:bg-amber-100 transition-colors">
            {/* Circular arrow */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M12 2v4H8"/>
              <path d="M2 7a5 5 0 015-5 5 5 0 013.5 1.4L12 6"/>
              <path d="M2 7a5 5 0 005 5 5 5 0 003.5-1.4"/>
            </svg>
          </button>
        )}
        {!isActive && (
          <button onClick={() => onRemove(item.id)} aria-label="Remove" className="w-7 h-7 rounded-md flex items-center justify-center text-surface-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <line x1="3" y1="3" x2="11" y2="11"/>
              <line x1="11" y1="3" x2="3"  y2="11"/>
            </svg>
          </button>
        )}
        {status === 'done' && (
          <span className="w-7 h-7 flex items-center justify-center text-emerald-500">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,8 6.5,11.5 13,5"/>
            </svg>
          </span>
        )}
      </div>
    </div>
  );
};

export default FileCard;
