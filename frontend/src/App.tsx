import React, { Suspense, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { Navbar }   from '@/components/Navbar';
import { Sidebar }  from '@/components/Sidebar';
import { LoadingIndicator } from '@/components/LoadingIndicator';

// Lazy-load pages so each page's JS only loads when visited
const HomePage      = React.lazy(() => import('@/pages/Home'));
const ChatPage      = React.lazy(() => import('@/pages/Chat'));
const DocumentsPage = React.lazy(() => import('@/pages/Documents'));
const SettingsPage  = React.lazy(() => import('@/pages/Settings'));

/** Full-screen loading fallback shown while a lazy page chunk loads */
function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <LoadingIndicator variant="spinner" label="Loading…" size="lg" />
    </div>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    // Full viewport shell – flex column so Navbar takes fixed height, rest fills
    <div className="flex flex-col h-full overflow-hidden bg-surface-200">
      {/* ── Top navbar ─────────────────────────────────────────────── */}
      <Navbar
        onMenuToggle={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
      />

      {/* ── Body: sidebar + main content ───────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* ── Main content area ───────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/"          element={<HomePage />} />
              <Route path="/chat"      element={<ChatPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/settings"  element={<SettingsPage />} />
              {/* Catch-all → home */}
              <Route path="*"          element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
