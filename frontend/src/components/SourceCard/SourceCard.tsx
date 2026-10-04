import React, { useState } from 'react';
import type { Source } from '@/types';
import { truncate } from '@/utils/format';

interface Props { source: Source; index: number; }

export const SourceCard: React.FC<Props> = ({ source, index }) => {
  const [expanded, setExpanded] = useState(false);
  const filename = source.file ?? 'Unknown document';
  const page = source.page;
  const snippet = typeof source.snippet === 'string' ? source.snippet : null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-brand-50 border border-brand-200/60 hover:border-brand-300 transition-colors text-sm">
      {/* Page-corner icon */}
      <div className="shrink-0 w-8 h-8 rounded-md bg-white border border-surface-200 flex items-center justify-center mt-0.5 shadow-sm">
        <svg className="w-4 h-4 text-brand-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14h10a1 1 0 001-1V5l-3-3H3a1 1 0 00-1 1v10a1 1 0 001 1z"/>
          <path d="M11 2v3h3"/>
          <line x1="5" y1="8"  x2="11" y2="8"/>
          <line x1="5" y1="11" x2="9"  y2="11"/>
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-surface-800 truncate leading-tight" title={filename}>{filename}</p>
            {page !== undefined && (
              <p className="text-xs text-brand-600 mt-0.5 font-medium">Page {page}</p>
            )}
          </div>
          <span className="shrink-0 text-[10px] text-surface-400 bg-white px-2 py-0.5 rounded-full border border-surface-200 font-mono">
            #{index + 1}
          </span>
        </div>
        {snippet && (
          <div className="mt-2">
            <p className="text-xs text-surface-600 leading-relaxed italic">
              {expanded ? snippet : truncate(snippet, 160)}
            </p>
            {snippet.length > 160 && (
              <button onClick={() => setExpanded(v => !v)} className="mt-1 text-xs text-brand-600 hover:text-brand-700 transition-colors font-medium">
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SourceCard;
