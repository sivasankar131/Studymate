import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { ErrorMessage } from '@/components/ErrorMessage';
import { formatDate, fileExtLabel, timeAgo } from '@/utils/format';
import type { Document } from '@/types';

interface Props {
  documents: Document[];
  loading: boolean;
  error: string | null;
  deletingId: string | null;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onUploadClick?: () => void;
  limit?: number;
}

const extStyle: Record<string, string> = {
  PDF: 'text-red-600 bg-red-50 border-red-200',
  TXT: 'text-blue-600 bg-blue-50 border-blue-200',
};

/** Document page icon */
const DocIcon = () => (
  <svg className="w-5 h-5 text-surface-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 17h12a1 1 0 001-1V7l-4-4H4a1 1 0 00-1 1v12a1 1 0 001 1z"/>
    <path d="M13 3v4h4"/>
    <line x1="6" y1="11" x2="12" y2="11"/>
    <line x1="6" y1="14" x2="10" y2="14"/>
  </svg>
);

/** Empty folder icon */
const FolderEmptyIcon = () => (
  <svg className="w-14 h-14 text-surface-300" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 36V14a2 2 0 012-2h10l4 4h18a2 2 0 012 2v18a2 2 0 01-2 2H8a2 2 0 01-2-2z"/>
    <line x1="18" y1="26" x2="30" y2="26"/>
    <line x1="24" y1="20" x2="24" y2="32"/>
  </svg>
);

export const DocumentList: React.FC<Props> = ({
  documents, loading, error, deletingId, onDelete, onRefresh, onUploadClick, limit,
}) => {
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const displayed = limit ? documents.slice(0, limit) : documents;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingIndicator variant="spinner" label="Loading documents…" size="md"/>
      </div>
    );
  }

  if (error) {
    return <ErrorMessage variant="banner" message={error} title="Failed to load documents" onRetry={onRefresh} className="mt-4"/>;
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FolderEmptyIcon/>}
        title="No documents yet"
        description="Upload a PDF or TXT file to get started. StudyMate will index it and make it searchable."
        action={onUploadClick ? (
          <button onClick={onUploadClick} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors shadow-sm">
            Upload your first document
          </button>
        ) : undefined}
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {displayed.map(doc => {
        const ext = fileExtLabel(doc.filename);
        const extCls = extStyle[ext] ?? 'text-surface-500 bg-surface-100 border-surface-200';
        const isDeleting  = deletingId === doc.id;
        const isConfirming = confirmId === doc.id;

        return (
          <div key={doc.id}
            className={`group flex items-start gap-4 p-4 rounded-2xl border transition-all duration-200 bg-white shadow-sm
              ${isDeleting ? 'opacity-40 pointer-events-none border-surface-200' : 'border-surface-200 hover:border-brand-300 hover:shadow-card'}`}
          >
            {/* Icon */}
            <div className="shrink-0 flex flex-col items-center gap-1.5">
              <div className="w-11 h-11 rounded-xl bg-surface-100 border border-surface-200 flex items-center justify-center">
                <DocIcon/>
              </div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${extCls}`}>{ext}</span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-surface-800 text-sm truncate leading-tight" title={doc.filename}>
                {doc.filename}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                <span className="text-xs text-surface-400 flex items-center gap-1">
                  {/* pages */}
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                    <rect x="2" y="1" width="8" height="10" rx="1"/>
                    <line x1="4" y1="4" x2="8" y2="4"/>
                    <line x1="4" y1="7" x2="7" y2="7"/>
                  </svg>
                  {doc.num_pages}p
                </span>
                <span className="text-xs text-surface-400 flex items-center gap-1">
                  {/* chunks */}
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                    <rect x="1" y="1" width="4" height="4" rx="0.5"/>
                    <rect x="7" y="1" width="4" height="4" rx="0.5"/>
                    <rect x="1" y="7" width="4" height="4" rx="0.5"/>
                    <rect x="7" y="7" width="4" height="4" rx="0.5"/>
                  </svg>
                  {doc.num_chunks} chunks
                </span>
                <span className="text-xs text-surface-400" title={formatDate(doc.created_at)}>{timeAgo(doc.created_at)}</span>
              </div>

              <div className="mt-2">
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" fill="#d1fae5" stroke="#6ee7b7" strokeWidth="1"/>
                    <polyline points="3,5 4.5,6.5 7,4" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Ready
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="shrink-0 flex flex-col sm:flex-row gap-2 items-end sm:items-center">
              <button onClick={() => navigate(`/chat?doc=${doc.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold border border-brand-200 transition-colors whitespace-nowrap">
                {/* Lightning – ask AI */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M8 1L3 8h4l-1 5 6-7H8l.5-5z"/>
                </svg>
                Ask Questions
              </button>

              {isConfirming ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => { setConfirmId(null); onDelete(doc.id); }}
                    className="px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors">
                    Delete
                  </button>
                  <button onClick={() => setConfirmId(null)}
                    className="px-2.5 py-1.5 rounded-lg text-surface-500 hover:text-surface-700 text-xs transition-colors">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(doc.id)} title="Delete document"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                  {isDeleting ? <LoadingIndicator variant="spinner" size="sm"/> : (
                    /* Trash can icon */
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3,4 13,4"/>
                      <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/>
                      <path d="M6 7v5M10 7v5"/>
                      <path d="M4 4l.8 9a1 1 0 001 .9h4.4a1 1 0 001-.9L12 4"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DocumentList;
