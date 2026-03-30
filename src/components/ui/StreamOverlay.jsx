import { useState, useEffect, useRef } from 'react';
import './StreamOverlay.css';

const DELAY_OPTIONS = [0, 10, 20, 30, 60]; // seconds

function generateStreamKey() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export default function StreamOverlay({ gameState, yourCards, visible, onClose }) {
  const [isLive, setIsLive] = useState(false);
  const [delay, setDelay] = useState(30);
  const [hideHoleCards, setHideHoleCards] = useState(true);
  const [streamKey] = useState(generateStreamKey);
  const [viewerCount, setViewerCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { id: 1, user: 'PokerFan99',  text: 'GL on the stream! 🃏' },
    { id: 2, user: 'RailBird',    text: 'Nice hand earlier!' },
    { id: 3, user: 'Viewer_42',   text: 'What stakes are you playing?' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const timerRef = useRef(null);
  const chatEndRef = useRef(null);

  // Simulate viewer count fluctuation when live
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setViewerCount(v => Math.max(0, v + Math.floor(Math.random() * 7) - 2));
    }, 5000);
    return () => clearInterval(interval);
  }, [isLive]);

  // Duration timer
  useEffect(() => {
    if (!isLive) { setDuration(0); return; }
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [isLive]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  function handleGoLive() {
    setIsLive(true);
    setViewerCount(Math.floor(Math.random() * 12) + 3);
  }

  function handleEndStream() {
    setIsLive(false);
    setViewerCount(0);
    setDuration(0);
  }

  function formatDuration(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function copyText(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  function handleChatSend() {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev.slice(-49), {
      id: Date.now(),
      user: gameState?.seats?.[gameState?.yourSeat]?.playerName || 'Streamer',
      text: chatInput.trim(),
    }]);
    setChatInput('');
  }

  const streamUrl = `${window.location.origin}?stream=${streamKey}`;
  const obsUrl = `rtmp://stream.pubpoker.gg/live/${streamKey}`;

  if (!visible) return null;

  return (
    <div className="stream-overlay-panel">
      <div className="stream-header">
        <span className="stream-logo">📡</span>
        <span className="stream-title">Live Stream</span>
        {isLive && (
          <span className="stream-live-badge">● LIVE</span>
        )}
        <button className="stream-close" onClick={onClose}>×</button>
      </div>

      {/* Status bar when live */}
      {isLive && (
        <div className="stream-status-bar">
          <span className="stream-viewers">👁 {viewerCount} watching</span>
          <span className="stream-duration">{formatDuration(duration)}</span>
          <button className="stream-end-btn" onClick={handleEndStream}>End Stream</button>
        </div>
      )}

      <div className="stream-body">
        {/* Left panel: controls */}
        <div className="stream-controls">
          {/* Stream URL */}
          <div className="stream-field">
            <label className="stream-label">Stream Link (share this)</label>
            <div className="stream-copy-row">
              <input className="stream-input" value={streamUrl} readOnly />
              <button className="stream-copy-btn" onClick={() => copyText(streamUrl, 'link')}>
                {copied === 'link' ? '✓' : '📋'}
              </button>
            </div>
          </div>

          {/* OBS RTMP */}
          <div className="stream-field">
            <label className="stream-label">OBS RTMP URL</label>
            <div className="stream-copy-row">
              <input className="stream-input stream-input--mono" value={obsUrl} readOnly />
              <button className="stream-copy-btn" onClick={() => copyText(obsUrl, 'rtmp')}>
                {copied === 'rtmp' ? '✓' : '📋'}
              </button>
            </div>
          </div>

          {/* Delay */}
          <div className="stream-field">
            <label className="stream-label">Card reveal delay</label>
            <div className="stream-delay-row">
              {DELAY_OPTIONS.map(d => (
                <button
                  key={d}
                  className={`stream-delay-btn ${delay === d ? 'active' : ''}`}
                  onClick={() => setDelay(d)}
                  disabled={isLive}
                >
                  {d === 0 ? 'None' : `${d}s`}
                </button>
              ))}
            </div>
            <div className="stream-delay-note">Hides your hole cards for {delay}s before revealing</div>
          </div>

          {/* Hide hole cards toggle */}
          <div className="stream-field stream-field--row">
            <label className="stream-label">Hide hole cards in stream view</label>
            <button
              className={`stream-toggle ${hideHoleCards ? 'active' : ''}`}
              onClick={() => setHideHoleCards(v => !v)}
            >
              {hideHoleCards ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Current cards preview */}
          {yourCards?.length > 0 && (
            <div className="stream-cards-preview">
              <span className="stream-label">Your cards</span>
              <div className="stream-cards-row">
                {yourCards.map((c, i) => (
                  <div key={i} className={`stream-card-chip ${hideHoleCards ? 'hidden' : ''}`}>
                    {hideHoleCards ? '🂠' : c}
                  </div>
                ))}
                {hideHoleCards && <span className="stream-hidden-note">Hidden from stream</span>}
              </div>
            </div>
          )}

          {/* Go live button */}
          {!isLive ? (
            <button className="stream-golive-btn" onClick={handleGoLive}>
              ● Go Live
            </button>
          ) : (
            <div className="stream-live-info">
              <div className="stream-live-indicator">● Broadcasting</div>
              <div className="stream-live-sub">
                Viewers can watch at the stream link above.
                Your hole cards {hideHoleCards ? `hidden for ${delay}s` : 'visible immediately'}.
              </div>
            </div>
          )}
        </div>

        {/* Right panel: stream chat */}
        <div className="stream-chat">
          <div className="stream-chat-header">💬 Stream Chat</div>
          <div className="stream-chat-feed">
            {chatMessages.map(msg => (
              <div key={msg.id} className="stream-chat-msg">
                <span className="stream-chat-user">{msg.user}</span>
                <span className="stream-chat-text">{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="stream-chat-input-row">
            <input
              className="stream-chat-input"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleChatSend()}
              placeholder="Message chat..."
            />
            <button className="stream-chat-send" onClick={handleChatSend}>▶</button>
          </div>
        </div>
      </div>
    </div>
  );
}
