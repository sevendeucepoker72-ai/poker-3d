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
import { memo } from 'react';

function FriendlyErrorFallback({ onReload }) {
  const handleReload = () => {
    if (typeof onReload === 'function') {
      try { onReload(); return; } catch { /* fall through to hard reload */ }
    }
    try { window.location.reload(); } catch { /* noop */ }
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
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#22D3EE' }}>
          Something went wrong
        </h2>
        <p style={{ marginTop: 12, lineHeight: 1.5, color: '#CBD5E1' }}>
          The app hit an unexpected error. Your chips, progress, and seat are
          safe on the server — a quick reload should bring you back in.
        </p>
        <button
          type="button"
          onClick={handleReload}
          style={{
            marginTop: 20,
            padding: '12px 22px',
            background: 'linear-gradient(180deg, #22D3EE, #0EA5E9)',
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
