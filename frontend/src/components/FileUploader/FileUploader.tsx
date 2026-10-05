import React, { useCallback, useRef, useState } from 'react';
import { FileCard } from '@/components/FileCard';
import { useUpload } from '@/hooks/useUpload';
import { SUPPORTED_EXTENSIONS, SUPPORTED_LABEL, MAX_UPLOAD_MB } from '@/utils/env';
import type { Document } from '@/types';

interface Props {
  onDocumentReady?: (doc: Document) => void;
  onAllDone?: () => void;
  className?: string;
}

export const FileUploader: React.FC<Props> = ({ onDocumentReady, onAllDone, className = '' }) => {
  const { queue, addFiles, removeFile, uploadAll, uploadOne, clearCompleted, isUploading } = useUpload();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);
  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; }
  }, [addFiles]);

  const handleUploadAll = useCallback(async () => {
    await uploadAll(doc => onDocumentReady?.(doc));
    onAllDone?.();
  }, [uploadAll, onDocumentReady, onAllDone]);

  const handleRetry = useCallback(async (id: string) => {
    await uploadOne(id, doc => onDocumentReady?.(doc));
  }, [uploadOne, onDocumentReady]);

  const pendingCount = queue.filter(s => s.status === 'pending').length;
  const doneCount    = queue.filter(s => s.status === 'done').length;
  const errorCount   = queue.filter(s => s.status === 'error').length;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Drop zone */}
      <div
        role="button" tabIndex={0}
        aria-label="Upload document – drag and drop or click to browse"
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center
          min-h-[200px] p-8 rounded-2xl border-2 border-dashed
          cursor-pointer select-none transition-all duration-200
          ${dragging
            ? 'border-brand-500 bg-brand-50 scale-[1.01] shadow-glow-brand'
            : 'border-surface-400 bg-surface-100 hover:border-brand-400 hover:bg-brand-50/60'
          }
        `}
      >
        <input ref={inputRef} type="file" multiple accept={SUPPORTED_EXTENSIONS.join(',')}
          onChange={onFileInputChange} className="sr-only" aria-hidden="true" tabIndex={-1} />

        {/* Icon */}
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4
          ${dragging ? 'bg-brand-100 text-brand-700' : 'bg-white border-2 border-surface-300 text-surface-600 shadow-sm'}`}>
          {dragging ? (
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="3" x2="12" y2="15" />
              <polyline points="8,11 12,15 16,11" />
              <path d="M4 19h16" />
              <path d="M4 15v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
            </svg>
          ) : (
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8l-5-5z" />
              <polyline points="14,3 14,8 19,8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9,15 12,12 15,15" />
            </svg>
          )}
        </div>

        <p className={`text-sm font-bold mb-1 ${dragging ? 'text-brand-700' : 'text-surface-800'}`}>
          {dragging ? 'Release to add files' : 'Drop files here or click to browse'}
        </p>
        <p className="text-xs font-semibold text-surface-600 mb-4">
          {dragging ? 'Files will be added to the upload queue' : 'Select one or multiple documents to upload'}
        </p>

        {!dragging && (
          <span className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold
                           hover:bg-brand-700 transition-colors shadow-sm">
            Choose Files
          </span>
        )}

        {/* Format badges */}
        <div className="absolute bottom-3 flex items-center gap-2">
          {SUPPORTED_EXTENSIONS.map(ext => (
            <span key={ext} className="text-[11px] font-bold text-surface-700 bg-white
                                       border-2 border-surface-300 px-2 py-0.5 rounded-full uppercase tracking-wide">
              {ext.replace('.', '')}
            </span>
          ))}
          <span className="text-[11px] font-semibold text-surface-600">· max {MAX_UPLOAD_MB} MB</span>
        </div>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div className="space-y-2 animate-[fadeIn_0.2s_ease-in-out]">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-bold text-surface-700">
              {queue.length} file{queue.length !== 1 ? 's' : ''} queued
              {doneCount > 0 && <span className="text-emerald-700"> · {doneCount} ready</span>}
              {errorCount > 0 && <span className="text-red-700"> · {errorCount} failed</span>}
            </p>
            {doneCount > 0 && (
              <button onClick={clearCompleted}
                className="text-xs font-semibold text-surface-500 hover:text-surface-800 transition-colors">
                Clear completed
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scroll">
            {queue.map(item => (
              <FileCard key={item.id} item={item} onRemove={removeFile} onRetry={handleRetry} />
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              {isUploading && (
                <p className="text-xs font-bold text-brand-700 flex items-center gap-1.5">
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-600"
                        style={{ animation: `bounceDot 1.4s ${i * 0.16}s infinite ease-in-out both` }} />
                    ))}
                  </span>
                  Uploading &amp; processing…
                </p>
              )}
            </div>
            {pendingCount > 0 && !isUploading && (
              <button onClick={handleUploadAll} disabled={isUploading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl
                           bg-brand-600 hover:bg-brand-700 disabled:opacity-50
                           text-white text-sm font-bold transition-colors shadow-sm">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="2" x2="8" y2="10" />
                  <polyline points="5,5 8,2 11,5" />
                  <path d="M3 12h10" />
                </svg>
                Upload {pendingCount} file{pendingCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="text-xs font-semibold text-surface-600 text-center">
        <span className="font-bold text-surface-800">Supported formats:</span> {SUPPORTED_LABEL} · max {MAX_UPLOAD_MB} MB
      </p>
    </div>
  );
};

export default FileUploader;
