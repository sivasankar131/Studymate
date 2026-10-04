import React, { useState } from 'react';
import { DocumentList } from '@/components/DocumentList';
import { FileUploader } from '@/components/FileUploader';
import { ErrorMessage } from '@/components/ErrorMessage';
import { useDocuments } from '@/hooks/useDocuments';
import type { Document } from '@/types';

export const DocumentsPage: React.FC = () => {
  const { documents, loading, error, refresh, deleteDocument, deletingId } = useDocuments();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);

  async function handleDelete(id: string) {
    setDeleteError(null);
    try { await deleteDocument(id); }
    catch (err) { setDeleteError(err instanceof Error ? err.message : 'Failed to delete document.'); }
  }

  function handleDocumentReady(_doc: Document) { void refresh(); }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-100">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-surface-200 bg-white shrink-0">
        <div>
          <h1 className="text-xl font-bold text-surface-900">Documents</h1>
          <p className="text-sm text-surface-400 mt-0.5">
            {documents.length} document{documents.length !== 1 ? 's' : ''} · PDF &amp; TXT supported
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button onClick={() => void refresh()} title="Refresh"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-700 hover:bg-surface-100 border border-surface-200 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M13.5 2.5v4h-4"/>
              <path d="M2.5 13.5v-4h4"/>
              <path d="M13.5 6.5A6 6 0 003.5 4"/>
              <path d="M2.5 9.5A6 6 0 0012.5 12"/>
            </svg>
          </button>
          {/* Upload toggle */}
          <button onClick={() => setShowUploader(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors
              ${showUploader ? 'bg-surface-100 text-surface-600 border border-surface-200 hover:bg-surface-200' : 'bg-brand-600 hover:bg-brand-700 text-white shadow-sm'}`}>
            {showUploader ? (
              <svg className="w-4 h-4" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/>
              </svg>
            )}
            {showUploader ? 'Close' : 'Upload'}
          </button>
        </div>
      </div>

      <div className="flex-1 px-6 py-5 space-y-5">
        {/* Upload panel */}
        {showUploader && (
          <div className="animate-[slideUp_0.3s_ease-out] bg-white border border-surface-200 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-surface-700 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-brand-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="2" x2="8" y2="10"/><polyline points="5,5 8,2 11,5"/>
                <path d="M3 13h10"/>
              </svg>
              Upload Documents
            </h2>
            <FileUploader onDocumentReady={handleDocumentReady} onAllDone={() => { void refresh(); setShowUploader(false); }}/>
          </div>
        )}

        {deleteError && (
          <ErrorMessage variant="banner" message={deleteError} title="Delete failed" onDismiss={() => setDeleteError(null)}/>
        )}

        <DocumentList documents={documents} loading={loading} error={error} deletingId={deletingId}
          onDelete={handleDelete} onRefresh={refresh} onUploadClick={() => setShowUploader(true)}/>
      </div>
    </div>
  );
};

export default DocumentsPage;
