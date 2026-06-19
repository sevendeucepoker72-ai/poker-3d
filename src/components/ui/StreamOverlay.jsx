import { useState } from 'react';
import StreamOverlayView from './StreamOverlayView';
import './StreamOverlay.css';

// 2026-06-18 — Phase 3g: real OBS browser-source overlay control panel.
// Replaces the fake "go live / RTMP / viewer count / stream chat" mock with a
// genuine tool: it builds the browser-source URL streamers paste into OBS,
// which renders a transparent live overlay of THIS table (StreamOverlayView,
// driven by real spectator game state). No streaming infra — OBS does the
// actual broadcasting; we just provide the graphic.

const DELAY_OPTIONS = [0, 10, 20, 30, 60]; // seconds — match your stream delay
const THEME_OPTIONS = [
  { id: 'sapphire', label: 'Sapphire' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'noir', label: 'Noir' },
];

export default function StreamOverlay({ gameState, visible, onClose }) {
  const [delay, setDelay] = useState(30);
  const [theme, setTheme] = useState('sapphire');
  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  const tableId = gameState?.tableId;
  const overlayUrl = tableId
    ? `${window.location.origin}?overlay=${encodeURIComponent(tableId)}&delay=${delay}&theme=${theme}`
    : '';

  function copyUrl() {
    if (!overlayUrl) return;
    navigator.clipboard?.writeText(overlayUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="stream-overlay-panel">
      <div className="stream-header">
        <span className="stream-logo">📡</span>
        <span className="stream-title">Stream Overlay</span>
        <button className="stream-close" onClick={onClose}>×</button>
      </div>

      <div className="stream-body">
        {/* Controls */}
        <div className="stream-controls">
          {!tableId ? (
            <div className="stream-field">
              <div className="stream-delay-note">
                Join a table first — the overlay broadcasts the table you're at.
              </div>
            </div>
          ) : (
            <>
              <div className="stream-field">
                <label className="stream-label">OBS Browser-Source URL</label>
                <div className="stream-copy-row">
                  <input className="stream-input stream-input--mono" value={overlayUrl} readOnly />
                  <button className="stream-copy-btn" onClick={copyUrl}>
                    {copied ? '✓' : '📋'}
                  </button>
                </div>
                <div className="stream-obs-note">
                  In OBS: <strong>Sources → + → Browser</strong>, paste this URL, set
                  Width 1280 / Height 720, and tick “Shutdown source when not visible”.
                  The background is transparent — it composites over your table capture.
                </div>
              </div>

              <div className="stream-field">
                <label className="stream-label">Broadcast delay (match your stream)</label>
                <div className="stream-delay-row">
                  {DELAY_OPTIONS.map(d => (
                    <button
                      key={d}
                      className={`stream-delay-btn ${delay === d ? 'active' : ''}`}
                      onClick={() => setDelay(d)}
                    >
                      {d === 0 ? 'None' : `${d}s`}
                    </button>
                  ))}
                </div>
                <div className="stream-delay-note">
                  Holds the overlay back {delay}s so it can't be used to snipe your table in real time.
                </div>
              </div>

              <div className="stream-field">
                <label className="stream-label">Theme</label>
                <div className="stream-delay-row">
                  {THEME_OPTIONS.map(o => (
                    <button
                      key={o.id}
                      className={`stream-delay-btn ${theme === o.id ? 'active' : ''}`}
                      onClick={() => setTheme(o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="stream-field">
                <div className="stream-delay-note">
                  🔒 Your hole cards are never shown on the overlay (it uses spectator data) —
                  only the board, pot, stacks, and showdown reveals appear.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Live preview */}
        <div className="stream-chat">
          <div className="stream-chat-header">👁 Live Preview</div>
          <div className="stream-preview-box">
            <StreamOverlayView previewState={gameState} theme={theme} />
          </div>
        </div>
      </div>
    </div>
  );
}
