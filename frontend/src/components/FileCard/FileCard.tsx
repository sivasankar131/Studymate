import React from 'react';
import { formatBytes, fileExtLabel } from '@/utils/format';
import type { UploadFile } from '@/types';

interface Props {
  item: UploadFile;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

// ── Stage config — label, colours, whether progress bar shows ───────────────
const STAGE = {
  pending: {
    label: 'Ready to upload',
    sublabel: null,
    color: 'text-surface-700',
    bg: 'bg-white border-surface-300',
    barColor: null,
    showBar: false,
    showSpinner: false,
  },
  uploading: {
    label: 'Uploading…',
    sublabel: 'Transferring file to server',
    color: 'text-brand-700',
    bg: 'bg-brand-50 border-brand-300',
    barColor: 'from-brand-500 to-brand-400',
    showBar: true,
    showSpinner: true,
  },
  queued: {
    label: 'Queued',
    sublabel: 'Waiting for processing to begin',
    color: 'text-surface-700',
    bg: 'bg-slate-50 border-slate-300',
    barColor: 'from-slate-400 to-slate-300',
    showBar: false,
    showSpinner: true,
  },
  processing: {
    label: 'Processing…',
    sublabel: 'Extracting text & splitting into chunks',
    color: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-300',
    barColor: 'from-amber-500 to-amber-400',
    showBar: true,
    showSpinner: true,
  },
  indexing: {
    label: 'Indexing…',
    sublabel: 'Generating embeddings & storing in vector database',
    color: 'text-violet-700',
    bg: 'bg-violet-50 border-violet-300',
    barColor: 'from-violet-500 to-violet-400',
    showBar: true,
    showSpinner: true,
  },
  done: {
    label: 'Ready',
    sublabel: 'Document indexed successfully',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-300',
    barColor: 'from-emerald-500 to-emerald-400',
    showBar: false,
    showSpinner: false,
  },
  error: {
    label: 'Failed',
    sublabel: null,
    color: 'text-red-700',
    bg: 'bg-red-50 border-red-300',
    barColor: null,
    showBar: false,
    showSpinner: false,
  },
} as const;

// ── Spinning dots indicator ──────────────────────────────────────────────────
function Spinner() {
  return (
    <span className="flex gap-0.5" role="status" aria-label="Processing">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-current"
          style={{ animation: `bounceDot 1.4s ${i * 0.16}s infinite ease-in-out both` }}
        />
      ))}
    </span>
  );
}

// ── Stage icon ───────────────────────────────────────────────────────────────
function StageIcon({ status }: { status: UploadFile['status'] }) {
  if (status === 'done') {
    return (
      <svg className="w-4 h-4 text-emerald-600" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3,8 6.5,11.5 13,5" />
      </svg>
    );
  }
  if (status === 'error') {
    return (
      <svg className="w-4 h-4 text-red-500" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <line x1="8" y1="5" x2="8" y2="9" />
        <circle cx="8" cy="11.5" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return null;
}

// ── Main component ───────────────────────────────────────────────────────────
export const FileCard: React.FC<Props> = ({ item, onRemove, onRetry }) => {
  const { file, status, error, progress } = item;
  const cfg = STAGE[status];
  const ext = fileExtLabel(file.name);
  const isActive = cfg.showSpinner;
  const canRemove = status === 'pending' || status === 'done' || status === 'error';

  // Progress percentage to display
  const pct = progress ?? 0;

  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border-2 transition-all duration-300 ${cfg.bg}`}>

      {/* File type badge */}
      <div className="shrink-0 w-11 h-11 rounded-xl bg-white border-2 border-surface-200
                      flex flex-col items-center justify-center shadow-sm gap-0.5">
        <svg className="w-5 h-5 text-surface-500" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14h10a1 1 0 001-1V5l-3-3H3a1 1 0 00-1 1v10a1 1 0 001 1z" />
          <path d="M11 2v3h3" />
        </svg>
        <span className="text-[8px] font-extrabold text-brand-700 leading-none tracking-wide">
          {ext}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Filename + size */}
        <p className="text-sm font-semibold text-surface-900 truncate leading-tight" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs font-medium text-surface-600 mt-0.5">{formatBytes(file.size)}</p>

        {/* Status row */}
        <div className={`flex items-center gap-2 mt-2 ${cfg.color}`}>
          {isActive && <Spinner />}
          {!isActive && <StageIcon status={status} />}
          <div className="flex flex-col">
            <span className="text-xs font-bold">{cfg.label}</span>
            {cfg.sublabel && (
              <span className="text-[11px] font-medium text-surface-600 leading-tight">
                {cfg.sublabel}
              </span>
            )}
          </div>
          {/* Progress percentage */}
          {cfg.showBar && pct > 0 && pct < 100 && (
            <span className="ml-auto text-xs font-bold tabular-nums">{pct}%</span>
          )}
        </div>

        {/* Progress bar */}
        {cfg.showBar && (
          <div className="mt-2 w-full bg-white/70 rounded-full h-2 overflow-hidden border border-white/50">
            <div
              className={`h-full bg-gradient-to-r ${cfg.barColor} rounded-full transition-all duration-500`}
              style={{ width: pct > 0 ? `${pct}%` : '6%' }}  /* show at least a sliver */
            />
          </div>
        )}

        {/* Indeterminate bar for queued state */}
        {status === 'queued' && (
          <div className="mt-2 w-full bg-white/70 rounded-full h-2 overflow-hidden">
            <div className="h-full w-1/3 bg-slate-400 rounded-full animate-[pulse_1.5s_ease-in-out_infinite]" />
          </div>
        )}

        {/* Error message */}
        {status === 'error' && error && (
          <p className="mt-2 text-xs font-medium text-red-700 leading-relaxed bg-red-100 rounded-lg px-2.5 py-1.5 border border-red-200">
            {error}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex flex-col gap-1 pt-0.5">
        {/* Retry */}
        {status === 'error' && (
          <button
            onClick={() => onRetry(item.id)}
            title="Retry upload"
            className="w-7 h-7 rounded-lg flex items-center justify-center
                       text-amber-700 bg-amber-100 hover:bg-amber-200
                       border border-amber-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none"
              stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M12 2v4H8" />
              <path d="M2 7a5 5 0 015-5 5 5 0 013.5 1.4L12 6" />
              <path d="M2 7a5 5 0 005 5 5 5 0 003.5-1.4" />
            </svg>
          </button>
        )}

        {/* Remove */}
        {canRemove && (
          <button
            onClick={() => onRemove(item.id)}
            aria-label="Remove file"
            title="Remove"
            className="w-7 h-7 rounded-lg flex items-center justify-center
                       text-surface-500 hover:text-red-600 hover:bg-red-50
                       border border-surface-200 hover:border-red-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none"
              stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default FileCard;
