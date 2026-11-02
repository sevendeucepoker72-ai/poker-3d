import { useState } from 'react';
import StreamOverlayView from './StreamOverlayView';
import { goLiveOverlayOffAt, QUALIFIER_OFFICIAL_STREAM_TEXT } from '../../utils/qualifierHelpTools';
import './StreamOverlay.css';

// 2026-06-18 — Phase 3g: real OBS browser-source overlay control panel.
// Replaces the fake "go live / RTMP / viewer count / stream chat" mock with a
// genuine tool: it builds the browser-source URL streamers paste into OBS,
// which renders a transparent live overlay of THIS table (StreamOverlayView,
// driven by real spectator game state). No streaming infra — OBS does the
// actual broadcasting; we just provide the graphic.
//
// 2026-11-02 (owner: stream the qualifiers) — copy fixes: the delay holds back
// ONLY this graphic (never the streamer's own capture or stream), and OBS's
// "Shutdown source when not visible" must stay UNTICKED (a hidden source would
// drop its connection and its delay buffer).
//
// Owner answer (b), 2026-11-02: at a QUALIFIER table (goLiveOverlayOffAt, the
// helpToolsOffAt evidence) EVERYONE, seated or watching, sees
// QUALIFIER_OFFICIAL_STREAM_TEXT in place of the URL, and the preview below
// is StreamOverlayView's neutral slate (no names, seats, stacks or cards).
// GameHUD's `ownQualifierSeat` (seated there) still hides it too. Every other
// table keeps the URL exactly as before. The panel itself is never removed.

const DELAY_OPTIONS = [0, 10, 20, 30, 60]; // seconds — match your stream delay
const THEME_OPTIONS = [
  { id: 'sapphire', label: 'Sapphire' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'noir', label: 'Noir' },
];

export default function StreamOverlay({ gameState, visible, onClose, ownQualifierSeat = false }) {
  const [delay, setDelay] = useState(30);
  const [theme, setTheme] = useState('sapphire');
  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  const tableId = gameState?.tableId;
  // Owner answer (b): no overlay URL at a qualifier table, for anyone.
  const qualifierOverlayOff = ownQualifierSeat === true || goLiveOverlayOffAt(gameState);
  const overlayUrl = tableId && !qualifierOverlayOff
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
          ) : qualifierOverlayOff ? (
            <div className="stream-field">
              <div className="stream-delay-note stream-qualifier-official-note" role="note" style={{ color: '#ffd24a', fontWeight: 700 }}>
                {QUALIFIER_OFFICIAL_STREAM_TEXT}
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
                  Width 1280 / Height 720, and leave “Shutdown source when not visible”
                  unticked, so the overlay keeps its connection and its delay when you switch scenes.
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
                  Holds only this overlay graphic back {delay}s so it lines up with your stream.
                  It does not delay your own table capture or your stream: set the same delay
                  in your streaming software.
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
