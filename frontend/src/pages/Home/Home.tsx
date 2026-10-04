import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentList } from '@/components/DocumentList';
import { FileUploader } from '@/components/FileUploader';
import { useDocuments } from '@/hooks/useDocuments';
import { useHealth } from '@/hooks/useHealth';
import { timeAgo } from '@/utils/format';

// ── Stat card ──────────────────────────────────────────────────────────────
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  border: string;
  valueColor: string;
  onClick?: () => void;
}
const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub, border, valueColor, onClick }) => (
  <button onClick={onClick} disabled={!onClick}
    className={`w-full text-left p-4 rounded-2xl border bg-white shadow-sm hover:shadow-card transition-all duration-150 ${border} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
    <div className="flex items-start justify-between mb-2">
      <div className="w-9 h-9 rounded-xl bg-surface-100 flex items-center justify-center text-surface-500">{icon}</div>
      {sub && <span className="text-[10px] text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">{sub}</span>}
    </div>
    <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
    <p className="text-xs text-surface-400 mt-0.5">{label}</p>
  </button>
);

// ── Feature tile ───────────────────────────────────────────────────────────
interface FeatureTileProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  action: string;
  accentBg: string;
  accentText: string;
  onClick: () => void;
}
const FeatureTile: React.FC<FeatureTileProps> = ({ icon, title, desc, action, accentBg, accentText, onClick }) => (
  <div className="flex flex-col gap-3 p-5 rounded-2xl bg-white border border-surface-200 shadow-sm hover:shadow-card hover:border-brand-200 transition-all duration-150 group">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accentBg}`}>{icon}</div>
    <div>
      <h3 className="text-sm font-semibold text-surface-800">{title}</h3>
      <p className="text-xs text-surface-400 mt-1 leading-relaxed">{desc}</p>
    </div>
    <button onClick={onClick} className={`mt-auto self-start flex items-center gap-1.5 text-xs font-semibold ${accentText} transition-colors`}>
      {action}
      <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <polyline points="4,2 8,6 4,10"/>
      </svg>
    </button>
  </div>
);

// ── SVG icons for stat cards ───────────────────────────────────────────────
const IconDocs = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 17h12a1 1 0 001-1V7l-4-4H4a1 1 0 00-1 1v12a1 1 0 001 1z"/>
    <path d="M13 3v4h4"/>
    <line x1="6" y1="11" x2="12" y2="11"/>
    <line x1="6" y1="14" x2="10" y2="14"/>
  </svg>
);
const IconChunks = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="5" height="5" rx="1"/>
    <rect x="12" y="3" width="5" height="5" rx="1"/>
    <rect x="3" y="12" width="5" height="5" rx="1"/>
    <rect x="12" y="12" width="5" height="5" rx="1"/>
  </svg>
);
const IconClock = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="7"/>
    <polyline points="10,6 10,10 13,12"/>
  </svg>
);
const IconBolt = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
    <path d="M11.5 2L5 11h6l-1.5 7L17 9h-6l.5-7z"/>
  </svg>
);

// ── Icons for feature tiles ────────────────────────────────────────────────
const UploadIcon = () => (
  <svg className="w-5 h-5 text-brand-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <line x1="10" y1="3" x2="10" y2="13"/>
    <polyline points="6,7 10,3 14,7"/>
    <path d="M4 16h12"/>
  </svg>
);
const SearchIcon = () => (
  <svg className="w-5 h-5 text-accent-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="9" r="5.5"/>
    <line x1="13.5" y1="13.5" x2="17" y2="17"/>
  </svg>
);
const AgentIcon = () => (
  <svg className="w-5 h-5 text-amber-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="10,2 13,8 19,9 14.5,13.5 15.5,19.5 10,16.5 4.5,19.5 5.5,13.5 1,9 7,8"/>
  </svg>
);

// ── Page ───────────────────────────────────────────────────────────────────
export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { documents, loading, error, refresh, deleteDocument, deletingId } = useDocuments();
  const { status, detail } = useHealth(60_000);
  const [showUploader, setShowUploader] = useState(false);

  const totalChunks = documents.reduce((a, d) => a + d.num_chunks, 0);
  const latestDoc   = documents[0];

  const statusColor =
    status === 'ok'       ? 'text-emerald-700 bg-emerald-50  border-emerald-200' :
    status === 'degraded' ? 'text-amber-700  bg-amber-50   border-amber-200'   :
    status === 'offline'  ? 'text-red-700    bg-red-50     border-red-200'     :
                            'text-surface-500 bg-surface-100 border-surface-200';

  const statusLabel =
    status === 'ok'       ? 'All systems operational' :
    status === 'degraded' ? 'Backend degraded' :
    status === 'offline'  ? 'Backend offline' :
                            'Checking backend…';

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-100">
      {/* Hero */}
      <div className="px-6 pt-8 pb-6 border-b border-surface-200 bg-white">
        <div className="mb-4">
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-medium ${statusColor}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current"/>
            {statusLabel}
            {detail && status === 'degraded' && <span className="opacity-70"> · DB: {detail.database} · Vec: {detail.vector_store}</span>}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-surface-900 leading-tight">
              Welcome to <span className="text-brand-600">StudyMate</span>
            </h1>
            <p className="text-surface-500 mt-1.5 text-sm leading-relaxed max-w-lg">
              Upload your documents, ask anything, learn smarter — powered by RAG and Groq LLM.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setShowUploader(v => !v)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-100 hover:bg-surface-200 border border-surface-300 text-surface-700 text-sm font-semibold transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="2" x2="8" y2="10"/><polyline points="5,5 8,2 11,5"/>
                <path d="M3 13h10"/>
              </svg>
              Upload
            </button>
            <button onClick={() => navigate('/chat')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors shadow-sm">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M9.5 1L3 9h5l-1.5 6L14 7H9L9.5 1z"/>
              </svg>
              Ask AI
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-8">
        {/* Upload panel */}
        {showUploader && (
          <div className="animate-[slideUp_0.3s_ease-out] bg-white border border-surface-200 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-surface-700 mb-4">Upload Documents</h2>
            <FileUploader onDocumentReady={() => void refresh()} onAllDone={() => { void refresh(); setShowUploader(false); }}/>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={<IconDocs/>}    label="Total Documents" value={documents.length}               border="border-brand-200"   valueColor="text-brand-600"  onClick={() => navigate('/documents')}/>
          <StatCard icon={<IconChunks/>}  label="Total Chunks"    value={totalChunks.toLocaleString()}   border="border-accent-200"  valueColor="text-accent-600" sub="indexed"/>
          <StatCard icon={<IconClock/>}   label="Latest Upload"   value={latestDoc ? timeAgo(latestDoc.created_at) : '—'} border="border-emerald-200" valueColor="text-emerald-600" sub={latestDoc?.filename.slice(0,16)} onClick={latestDoc ? () => navigate('/documents') : undefined}/>
          <StatCard icon={<IconBolt/>}    label="Ask Questions"   value="Chat →"                         border="border-amber-200"   valueColor="text-amber-600"  sub="RAG + Agent" onClick={() => navigate('/chat')}/>
        </div>

        {/* Feature tiles */}
        <div>
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">What you can do</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FeatureTile icon={<UploadIcon/>} title="Upload Documents"
              desc="Drop PDF or TXT files. StudyMate extracts, chunks, and embeds them into a vector index."
              action="Go to Documents" accentBg="bg-brand-50" accentText="text-brand-600 hover:text-brand-700"
              onClick={() => navigate('/documents')}/>
            <FeatureTile icon={<SearchIcon/>} title="Ask Questions"
              desc="Ask anything about your documents and get answers with exact page and source references."
              action="Open Chat" accentBg="bg-accent-50" accentText="text-accent-600 hover:text-accent-700"
              onClick={() => navigate('/chat')}/>
            <FeatureTile icon={<AgentIcon/>} title="Agent Mode"
              desc="Multi-step reasoning: summarise, quiz yourself, compare sections, and more."
              action="Try Agent" accentBg="bg-amber-50" accentText="text-amber-600 hover:text-amber-700"
              onClick={() => navigate('/chat')}/>
          </div>
        </div>

        {/* Recent docs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Recent Documents</h2>
            <button onClick={() => navigate('/documents')} className="text-xs text-brand-600 hover:text-brand-700 transition-colors font-medium">View all →</button>
          </div>
          <DocumentList documents={documents} loading={loading} error={error} deletingId={deletingId}
            onDelete={async id => { try { await deleteDocument(id); } catch { /* ignore */ } }}
            onRefresh={refresh} onUploadClick={() => setShowUploader(true)} limit={3}/>
          {documents.length > 3 && (
            <button onClick={() => navigate('/documents')}
              className="w-full mt-3 py-2 rounded-xl border border-surface-200 text-xs text-surface-400 hover:text-surface-700 hover:bg-white transition-colors">
              + {documents.length - 3} more documents
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default HomePage;
