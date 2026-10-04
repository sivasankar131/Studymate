import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChatWindow } from '@/components/ChatWindow';
import { MessageInput } from '@/components/MessageInput';
import { ErrorMessage } from '@/components/ErrorMessage';
import { useChat } from '@/hooks/useChat';
import { useDocuments } from '@/hooks/useDocuments';

export const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlDocId = searchParams.get('doc') ?? undefined;
  const { documents } = useDocuments();

  const { messages, thinking, sendMessage, clearConversation, setDocId, setMode, activeDocId, activeMode } =
    useChat({ docId: urlDocId, mode: 'rag' });

  useEffect(() => { setDocId(urlDocId); }, [urlDocId, setDocId]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clearError, setClearError]   = useState<string | null>(null);
  const activeDoc = documents.find(d => d.id === activeDocId);

  function handleDocSelect(docId: string | undefined) {
    setDocId(docId);
    const params = new URLSearchParams(searchParams);
    if (docId) params.set('doc', docId); else params.delete('doc');
    navigate(`/chat?${params.toString()}`, { replace: true });
    setSidebarOpen(false);
  }

  async function handleClear() {
    setClearError(null);
    try { await clearConversation(); }
    catch (err) { setClearError(err instanceof Error ? err.message : 'Failed to clear.'); }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-surface-900/20 z-10 lg:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} aria-hidden="true"/>
      )}

      {/* Doc selector panel */}
      <aside className={`absolute lg:relative top-0 bottom-0 left-0 z-20 w-60 flex flex-col bg-white border-r border-surface-200 shadow-sm
          transform transition-transform duration-200 lg:translate-x-0 lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-surface-200">
          <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Document Filter</h2>
          <p className="text-xs text-surface-400 mt-0.5">Restrict answers to one file</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2.5 space-y-0.5">
          {/* All docs */}
          <button onClick={() => handleDocSelect(undefined)}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors
              ${!activeDocId ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-surface-500 hover:text-surface-800 hover:bg-surface-100'}`}>
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6"/>
              <line x1="2" y1="8" x2="14" y2="8"/>
              <path d="M8 2a10 10 0 010 12M8 2a10 10 0 000 12"/>
            </svg>
            All documents
          </button>

          {documents.length === 0 && <p className="text-xs text-surface-300 px-3 py-2">No documents yet.</p>}

          {documents.map(doc => (
            <button key={doc.id} onClick={() => handleDocSelect(doc.id)} title={doc.filename}
              className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors
                ${activeDocId === doc.id ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-surface-500 hover:text-surface-800 hover:bg-surface-100'}`}>
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 14h10a1 1 0 001-1V5l-3-3H3a1 1 0 00-1 1v10a1 1 0 001 1z"/>
                <path d="M11 2v3h3"/>
              </svg>
              <span className="truncate">{doc.filename}</span>
            </button>
          ))}
        </div>
        <div className="p-2.5 border-t border-surface-200">
          <button onClick={() => navigate('/documents')}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 transition-colors border border-brand-200 font-semibold">
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/>
            </svg>
            Upload more documents
          </button>
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Chat header */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-surface-200 bg-white shadow-sm">
          {/* Doc filter toggle button */}
          <button onClick={() => setSidebarOpen(v => !v)} title="Filter by document"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors
              ${activeDocId ? 'bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100' : 'border-surface-200 text-surface-500 hover:bg-surface-100'}`}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h10l-4 5v4l-2-1V8L2 3z"/>
            </svg>
            {activeDoc ? <span className="max-w-[110px] truncate">{activeDoc.filename}</span> : 'All docs'}
            <svg className="w-3 h-3 opacity-40" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <polyline points="2,3.5 5,6.5 8,3.5"/>
            </svg>
          </button>

          {/* Title */}
          <div className="flex-1 text-center">
            <p className="text-sm font-bold text-surface-800">StudyMate AI</p>
            <p className="text-[11px] text-surface-400">
              {activeDoc ? `Answering from: ${activeDoc.filename}` : 'Ask questions about your documents'}
            </p>
          </div>

          {/* Mode badge */}
          <span className={`hidden sm:inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border font-semibold
              ${activeMode === 'agent' ? 'bg-accent-50 border-accent-200 text-accent-700' : 'bg-brand-50 border-brand-200 text-brand-700'}`}>
            {activeMode === 'agent' ? (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M7 1L2.5 7H6L5 11l5-6H7.5L7 1z"/></svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <rect x="2" y="3" width="8" height="7" rx="1"/><line x1="2" y1="2" x2="10" y2="2"/>
              </svg>
            )}
            {activeMode === 'agent' ? 'Agent' : 'RAG'}
          </span>
        </div>

        {clearError && (
          <ErrorMessage variant="banner" message={clearError} title="Clear failed" onDismiss={() => setClearError(null)} className="mx-4 mt-3"/>
        )}

        <ChatWindow messages={messages} thinking={thinking}
          activeDocName={activeDoc?.filename} onClearFilter={() => handleDocSelect(undefined)}/>

        <MessageInput onSend={sendMessage} disabled={false} thinking={thinking}
          mode={activeMode} onModeChange={m => setMode(m)} onClear={handleClear}
          placeholder={activeDoc ? `Ask about "${activeDoc.filename}"…` : 'Ask anything about your documents…'}/>
      </div>
    </div>
  );
};

export default ChatPage;
