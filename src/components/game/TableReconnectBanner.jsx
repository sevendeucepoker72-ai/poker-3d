/**
 * TableReconnectBanner — .online fix round 1 (2026-10-11, TABLEUI-12).
 *
 * The table screen had no reconnect indicator (the lobby's banner is not drawn
 * there; GameHUD's 8px conn-dot had no style at all for 'error' / 'failed').
 * This strip sits just under the top bar while the socket is not connected:
 *   disconnected → "Reconnecting… your seat is held"
 *   error        → "Connection problem — retrying…"
 *   failed       → "Connection lost" + a "Tap to reconnect" button
 *                  (socket.io gave up; forceReconnect builds a new socket).
 * The strip itself never takes a tap (pointer-events: none); only the button
 * does. Blue + gold, never red. Rendered by App.jsx's table branch OUTSIDE the
 * table error boundary, so it stays up even if the table view fails.
 */
import { useEffect, useState } from 'react';
import { subscribeConnectionStatus, forceReconnect } from '../../services/socketService';

const TEXT = {
  disconnected: 'Reconnecting… your seat is held',
  error: 'Connection problem — retrying…',
  failed: 'Connection lost',
};

export default function TableReconnectBanner() {
  const [status, setStatus] = useState('connected');

  useEffect(() => {
    const unsub = subscribeConnectionStatus((s) => setStatus(s));
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  if (!TEXT[status]) return null;
  const failed = status === 'failed';

  return (
    <>
    <style>{'@keyframes tableReconnectPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }'}</style>
    <div
      className={`table-reconnect-banner table-reconnect-banner--${status}`}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'calc(max(36px, calc(env(safe-area-inset-top, 0px) + 8px)) + 48px)',
        left: '50%', transform: 'translateX(-50%)',
        zIndex: 9500, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: 10,
        maxWidth: 'calc(100vw - 32px)',
        padding: '7px 14px', borderRadius: 999,
        background: 'rgba(8, 20, 52, 0.94)',
        border: '1px solid rgba(255, 210, 74, 0.6)',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.5)',
        color: '#ffd24a', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: failed ? '#93c5fd' : '#ffd24a',
          animation: failed ? 'none' : 'tableReconnectPulse 1.1s ease-in-out infinite',
        }}
      />
      <span>{TEXT[status]}</span>
      {failed && (
        <button
          type="button"
          className="table-reconnect-banner__btn"
          onClick={() => { try { forceReconnect(); } catch { /* ignore */ } }}
          style={{
            pointerEvents: 'auto', minHeight: 44, padding: '6px 14px',
            borderRadius: 999, border: '1px solid rgba(255, 210, 74, 0.8)',
            background: 'linear-gradient(135deg, #1e3a8a, #0d2c53)',
            color: '#ffd24a', fontWeight: 800, fontSize: 12, cursor: 'pointer',
          }}
        >
          Tap to reconnect
        </button>
      )}
    </div>
    </>
  );
}
