import React, { useState } from 'react';
import { useHealth } from '@/hooks/useHealth';
import { getApiBase, SUPPORTED_LABEL, MAX_UPLOAD_MB } from '@/utils/env';
import { LoadingIndicator } from '@/components/LoadingIndicator';

// ── Section wrapper ────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({
  title, icon, children,
}) => (
  <div className="bg-surface-700/30 border border-surface-400/20 rounded-2xl overflow-hidden">
    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-surface-400/20 bg-surface-700/20">
      <span className="text-lg">{icon}</span>
      <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
    </div>
    <div className="px-5 py-4 space-y-3">{children}</div>
  </div>
);

// ── Row inside a section ───────────────────────────────────────────────────
const Row: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({
  label, value, mono = false,
}) => (
  <div className="flex items-center justify-between gap-4 py-1.5 border-b border-surface-400/10 last:border-0">
    <span className="text-xs text-slate-500">{label}</span>
    <span className={`text-xs text-slate-300 text-right ${mono ? 'font-mono bg-surface-500/40 px-2 py-0.5 rounded' : ''}`}>
      {value}
    </span>
  </div>
);

// ── Status dot ─────────────────────────────────────────────────────────────
const Dot: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1.5 text-xs font-medium
    ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
    <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
    {label}
  </span>
);

// ── Main page ──────────────────────────────────────────────────────────────
export const SettingsPage: React.FC = () => {
  const { status, detail, lastChecked, check } = useHealth();
  const [checking, setChecking] = useState(false);
  const apiBase = getApiBase();

  async function handleRecheck() {
    setChecking(true);
    await check();
    setChecking(false);
  }

  // ── CORS reminder ──────────────────────────────────────────────────────
  const corsNote = `For local dev, ensure your backend .env has:\nFRONTEND_URL=http://localhost:5173\n\nFor production:\nFRONTEND_URL=https://your-frontend-domain.vercel.app`;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-5 border-b border-surface-400/20 shrink-0">
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configuration, backend status and deployment info</p>
      </div>

      <div className="flex-1 px-6 py-6 space-y-5 max-w-2xl">

        {/* ── Backend connection ─────────────────────────────────────── */}
        <Section title="Backend Connection" icon="🔌">
          <Row
            label="API Base URL"
            value={apiBase}
            mono
          />
          <Row
            label="Environment"
            value={import.meta.env.MODE}
            mono
          />
          <div className="pt-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500">Service Health</span>
              <button
                onClick={handleRecheck}
                disabled={checking}
                className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 disabled:opacity-50 transition-colors"
              >
                {checking
                  ? <LoadingIndicator variant="spinner" size="sm" />
                  : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 20v-5h-.581M4.582 9A8 8 0 0120 15M19.418 15A8 8 0 014 9" />
                    </svg>
                  )
                }
                Re-check
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-surface-600/30 border border-surface-400/20 text-center">
                <p className="text-[10px] text-slate-600 mb-1.5 uppercase tracking-wide">API</p>
                {status === 'checking' ? (
                  <LoadingIndicator variant="dots" size="sm" />
                ) : (
                  <Dot ok={status === 'ok' || status === 'degraded'} label={status === 'ok' || status === 'degraded' ? 'Online' : 'Offline'} />
                )}
              </div>
              <div className="p-3 rounded-xl bg-surface-600/30 border border-surface-400/20 text-center">
                <p className="text-[10px] text-slate-600 mb-1.5 uppercase tracking-wide">Database</p>
                {status === 'checking' ? (
                  <LoadingIndicator variant="dots" size="sm" />
                ) : (
                  <Dot ok={detail?.database === 'ok'} label={detail?.database === 'ok' ? 'OK' : detail?.database ?? 'Unknown'} />
                )}
              </div>
              <div className="p-3 rounded-xl bg-surface-600/30 border border-surface-400/20 text-center">
                <p className="text-[10px] text-slate-600 mb-1.5 uppercase tracking-wide">Vector DB</p>
                {status === 'checking' ? (
                  <LoadingIndicator variant="dots" size="sm" />
                ) : (
                  <Dot ok={detail?.vector_store === 'ok'} label={detail?.vector_store === 'ok' ? 'OK' : detail?.vector_store ?? 'Unknown'} />
                )}
              </div>
            </div>
            {lastChecked && (
              <p className="text-[10px] text-slate-600 mt-2 text-right">
                Last checked: {lastChecked.toLocaleTimeString()}
              </p>
            )}
          </div>
        </Section>

        {/* ── Upload limits ──────────────────────────────────────────── */}
        <Section title="Upload Configuration" icon="📤">
          <Row label="Supported file types" value={SUPPORTED_LABEL} />
          <Row label="Max file size" value={`${MAX_UPLOAD_MB} MB`} />
          <Row label="Backend ingest endpoint" value="POST /upload" mono />
          <p className="text-xs text-slate-600 leading-relaxed pt-1">
            To support additional formats (DOCX, XLSX, PPTX…), extend the backend ingest pipeline and update{' '}
            <code className="text-brand-400 bg-surface-500/40 px-1 rounded">ALLOWED_EXTENSIONS</code> in{' '}
            <code className="text-brand-400 bg-surface-500/40 px-1 rounded">app/routes/upload.py</code>.
          </p>
        </Section>

        {/* ── Chat / RAG config ─────────────────────────────────────── */}
        <Section title="AI Configuration" icon="🤖">
          <Row label="Plain RAG endpoint" value="POST /chat" mono />
          <Row label="Agent endpoint" value="POST /agent/chat" mono />
          <Row label="History endpoint" value="GET /history/{session_id}" mono />
          <Row label="Session storage" value="sessionStorage (browser tab)" />
          <Row label="Context window" value="Last 10 messages" />
          <p className="text-xs text-slate-600 leading-relaxed pt-1">
            The LLM model, embedding model, chunk size, and top-K are configured in the{' '}
            <code className="text-brand-400 bg-surface-500/40 px-1 rounded">backend/.env</code> file.
            No model keys are stored in the frontend.
          </p>
        </Section>

        {/* ── CORS reminder ──────────────────────────────────────────── */}
        <Section title="CORS Configuration" icon="🌐">
          <p className="text-xs text-slate-400 leading-relaxed">
            The backend reads its allowed origins from the{' '}
            <code className="text-brand-400 bg-surface-500/40 px-1 rounded">FRONTEND_URL</code> environment variable.
          </p>
          <pre className="text-xs text-slate-400 bg-surface-800/60 border border-surface-500/30 rounded-xl p-3 overflow-x-auto whitespace-pre leading-relaxed font-mono">
            {corsNote}
          </pre>
        </Section>

        {/* ── Deployment ────────────────────────────────────────────── */}
        <Section title="Deployment" icon="🚀">
          <Row label="Frontend host" value="Vercel (recommended)" />
          <Row label="Build command" value="npm run build" mono />
          <Row label="Output directory" value="dist" mono />
          <div className="pt-1">
            <p className="text-xs text-slate-500 mb-2">Required Vercel environment variable:</p>
            <pre className="text-xs text-emerald-400 bg-surface-800/60 border border-surface-500/30 rounded-xl p-3 font-mono">
              VITE_API_BASE_URL=https://your-backend-domain.com
            </pre>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Never put API keys (Groq, Qdrant) in this frontend environment variable. Keep all secrets in the backend.
          </p>
        </Section>

        {/* ── About ─────────────────────────────────────────────────── */}
        <Section title="About StudyMate" icon="📚">
          <Row label="Application" value="StudyMate – AI Document Assistant" />
          <Row label="Frontend" value="React 18 + Vite + TypeScript + Tailwind CSS" />
          <Row label="Backend" value="FastAPI + SQLAlchemy + Qdrant + Groq" />
          <Row label="RAG pipeline" value="BGE Embeddings → Qdrant → Groq LLM" />
          <Row label="Version" value="1.0.0" mono />
        </Section>
      </div>
    </div>
  );
};

export default SettingsPage;
