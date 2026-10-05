import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useHealth } from '@/hooks/useHealth';

interface Props {
  onMenuToggle: () => void;
  sidebarOpen: boolean;
}

const statusDot: Record<string, string> = {
  ok:       'bg-emerald-500',
  degraded: 'bg-amber-400',
  offline:  'bg-red-400',
  checking: 'bg-surface-400 animate-pulse',
};

const statusLabel: Record<string, string> = {
  ok:       'Backend online',
  degraded: 'Backend degraded',
  offline:  'Backend offline',
  checking: 'Checking…',
};

/** Unique geometric logo mark – stacked pages + spark */
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0d9488"/>
      <rect x="6" y="19" width="18" height="2" rx="1" fill="#99f6e4" opacity="0.45"/>
      <rect x="5" y="14" width="18" height="9" rx="2" fill="#ccfbf1"/>
      <rect x="7" y="8" width="18" height="10" rx="2" fill="white"/>
      <line x1="10" y1="12" x2="22" y2="12" stroke="#0d9488" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="10" y1="15" x2="19" y2="15" stroke="#0d9488" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="8" r="2" fill="#f0fdfa"/>
      <line x1="24" y1="5.5" x2="24" y2="4.5" stroke="#f0fdfa" strokeWidth="1" strokeLinecap="round"/>
      <line x1="24" y1="11.5" x2="24" y2="12.5" stroke="#f0fdfa" strokeWidth="1" strokeLinecap="round"/>
      <line x1="21.5" y1="8" x2="20.5" y2="8" stroke="#f0fdfa" strokeWidth="1" strokeLinecap="round"/>
      <line x1="26.5" y1="8" x2="27.5" y2="8" stroke="#f0fdfa" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

export const Navbar: React.FC<Props> = ({ onMenuToggle, sidebarOpen }) => {
  const { status } = useHealth(60_000);
  const location = useLocation();

  const titles: Record<string, string> = {
    '/':          'Dashboard',
    '/chat':      'AI Chat',
    '/documents': 'Documents',
    '/settings':  'Settings',
  };
  const pageTitle = titles[location.pathname] ?? 'StudyMate';

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-surface-300 bg-white/90 backdrop-blur-sm z-30 shadow-sm">
      {/* Left */}
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          onClick={onMenuToggle}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg text-surface-600 hover:text-surface-900 hover:bg-surface-200 transition-colors"
        >
          {sidebarOpen ? (
            /* X – two diagonal strokes */
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <line x1="4" y1="4" x2="16" y2="16"/>
              <line x1="16" y1="4" x2="4" y2="16"/>
            </svg>
          ) : (
            /* Hamburger – three lines with varying widths */
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <line x1="3" y1="5"  x2="17" y2="5"/>
              <line x1="3" y1="10" x2="14" y2="10"/>
              <line x1="3" y1="15" x2="17" y2="15"/>
            </svg>
          )}
        </button>

        <Link to="/" className="flex items-center gap-2 select-none">
          <LogoMark size={28} />
          <span className="font-bold text-surface-900 text-base tracking-tight hidden sm:block">
            Study<span className="text-brand-600">Mate</span>
          </span>
        </Link>

        <span className="hidden md:block text-surface-400 text-sm select-none">/</span>
        <span className="hidden md:block text-surface-500 font-semibold text-sm">{pageTitle}</span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* Health pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-100 border border-surface-300" title={statusLabel[status]}>
          <span className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
          <span className="text-xs font-semibold text-surface-600">{statusLabel[status]}</span>
        </div>

        {/* Ask AI CTA */}
        <Link
          to="/chat"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors shadow-glow-sm"
        >
          {/* Lightning bolt – unique, not the standard chat bubble */}
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.5 1L3 9h5l-1.5 6L14 7H9L9.5 1z"/>
          </svg>
          Ask AI
        </Link>
      </div>
    </header>
  );
};

export default Navbar;
