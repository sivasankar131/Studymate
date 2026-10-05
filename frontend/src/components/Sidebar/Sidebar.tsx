import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

/* ── Unique hand-crafted icons ─────────────────────────────────────────────
   Each uses a distinct visual language – no generic heroicons clones.      */

/** Dashboard – four uneven tiles like a mosaic */
const IconDashboard = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="6" height="7" rx="1.5"/>
    <rect x="11" y="3" width="6" height="4" rx="1.5"/>
    <rect x="11" y="9" width="6" height="8" rx="1.5"/>
    <rect x="3" y="12" width="6" height="5" rx="1.5"/>
  </svg>
);

/** AI Chat – speech bubble with a small circuit node inside */
const IconChat = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h12a1 1 0 011 1v7a1 1 0 01-1 1H7l-3 3V5a1 1 0 011-1z"/>
    <circle cx="8"  cy="8" r="1" fill="currentColor" stroke="none"/>
    <circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>
  </svg>
);

/** Documents – stacked pages with a folded corner */
const IconDocuments = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17h10a1 1 0 001-1V7l-4-4H5a1 1 0 00-1 1v12a1 1 0 001 1z"/>
    <path d="M12 3v4h4"/>
    <line x1="7" y1="10" x2="13" y2="10"/>
    <line x1="7" y1="13" x2="11" y2="13"/>
  </svg>
);

/** Settings – a slotted dial / tuning knob shape */
const IconSettings = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="2.5"/>
    <path d="M10 3v2M10 15v2M3 10h2M15 10h2"/>
    <path d="M5.05 5.05l1.42 1.42M13.54 13.54l1.41 1.41"/>
    <path d="M5.05 14.95l1.42-1.41M13.54 6.46l1.41-1.41"/>
  </svg>
);

/** Upload arrow pointing into a tray */
const IconUpload = () => (
  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="2" x2="8" y2="10"/>
    <polyline points="5,5 8,2 11,5"/>
    <path d="M3 12h10"/>
    <path d="M3 10v3a1 1 0 001 1h8a1 1 0 001-1v-3"/>
  </svg>
);

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: '/',          label: 'Dashboard', icon: <IconDashboard /> },
  { path: '/chat',      label: 'AI Chat',   icon: <IconChat /> },
  { path: '/documents', label: 'Documents', icon: <IconDocuments /> },
  { path: '/settings',  label: 'Settings',  icon: <IconSettings /> },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<Props> = ({ open, onClose }) => {
  const navigate = useNavigate();

  function handleNav(path: string) {
    navigate(path);
    onClose();
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-surface-900/30 z-20 lg:hidden backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed top-14 left-0 bottom-0 w-60 z-20
          flex flex-col
          bg-white border-r border-surface-300
          transform transition-transform duration-200 ease-in-out
          lg:static lg:translate-x-0 lg:z-auto lg:top-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Nav links */}
        <nav className="flex-1 px-2.5 py-4 space-y-0.5" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => onClose()}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                 ${isActive
                   ? 'bg-brand-50 text-brand-700 border border-brand-200'
                   : 'text-surface-600 hover:text-surface-900 hover:bg-surface-100 border border-transparent'
                 }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom CTA */}
        <div className="px-3 py-4 border-t border-surface-200">
          <button
            onClick={() => handleNav('/documents')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors shadow-glow-sm"
          >
            <IconUpload />
            Upload Document
          </button>
          <p className="text-center text-xs font-semibold text-surface-600 mt-2.5">
            Supports PDF &amp; TXT · max 10 MB
          </p>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
