// FriendlyErrorFallback
// ---------------------
// Rendered by the root ErrorBoundary in App.jsx when a render-time
// exception escapes. We intentionally do NOT print error.message or
// error.stack into the DOM — the stack is logged to console for
// devs (see ErrorBoundary.componentDidCatch), but users get a calm
// recovery screen with a Reload button.
//
// Created 2026-04-22 audit fixes: previously the boundary only
// wrapped GameHUD and rendered the raw stack to the user, which
// leaked implementation detail + looked like a crash dump.
//
// 2026-10-11 (.online fix round 1 — APPUI-23): Reload is a REAL page reload
// (services/appReload.reloadApp — it also drops a ?replay= link that may be
// what crashed). `updating` = the page is already reloading itself for a lazy
// chunk that failed to load: a calm "Updating…" instead of "Something went
// wrong"; the Reload button stays as a manual way out.
import { memo } from 'react';
import { reloadApp } from '../../services/appReload';

function FriendlyErrorFallback({ onReload, updating = false }) {
  const handleReload = () => {
    if (typeof onReload === 'function') {
      try { onReload(); return; } catch { /* fall through to hard reload */ }
    }
    reloadApp('error-screen');
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        background: 'linear-gradient(180deg, #0B0F19 0%, #111827 100%)',
        color: '#E5E7EB',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: 'rgba(17, 24, 39, 0.85)',
          border: '1px solid rgba(34, 211, 238, 0.35)',
          borderRadius: 16,
          padding: '28px 24px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#3b82f6' }}>
          {updating ? 'Updating…' : 'Something went wrong'}
        </h2>
        <p style={{ marginTop: 12, lineHeight: 1.5, color: '#CBD5E1' }}>
          {updating
            ? 'Loading the latest version of the game. Your chips, progress, and seat are safe on the server.'
            : 'The app hit an unexpected error. Your chips, progress, and seat are safe on the server — a quick reload should bring you back in.'}
        </p>
        <button
          type="button"
          onClick={handleReload}
          style={{
            marginTop: 20,
            padding: '12px 22px',
            background: 'linear-gradient(180deg, #3b82f6, #3b82f6)',
            color: '#0B0F19',
            border: 'none',
            borderRadius: 10,
            fontSize: '1rem',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export default memo(FriendlyErrorFallback);
