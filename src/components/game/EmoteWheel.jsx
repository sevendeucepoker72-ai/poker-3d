import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../../services/socketService';
import './EmoteWheel.css';

const EMOTES = [
  { id: 'nice', icon: '\uD83D\uDC4D', label: 'Nice' },
  { id: 'lol', icon: '\uD83D\uDE02', label: 'LOL' },
  { id: 'cool', icon: '\uD83D\uDE0E', label: 'Cool' },
  { id: 'angry', icon: '\uD83D\uDE21', label: 'Angry' },
  { id: 'thinking', icon: '\uD83E\uDD14', label: 'Thinking' },
  { id: 'dead', icon: '\uD83D\uDC80', label: 'Dead' },
  { id: 'fire', icon: '\uD83D\uDD25', label: 'Fire' },
  { id: 'gg', icon: '\uD83D\uDC4F', label: 'GG' },
];

export const EMOTE_MAP = Object.fromEntries(EMOTES.map((e) => [e.id, e]));

export default function EmoteWheel({ disabled }) {
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const cooldownRef = useRef(null);

  const sendEmote = useCallback((emoteId) => {
    if (cooldown) return;
    const socket = getSocket();
    if (socket) {
      socket.emit('emote', { emoteId });
    }
    setOpen(false);
    setCooldown(true);
    cooldownRef.current = setTimeout(() => setCooldown(false), 3000);
  }, [cooldown]);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  // Position emotes in a circle
  const radius = 80;
  const centerX = 120;
  const centerY = 120;

  return (
    <>
      <button
        className="emote-trigger-btn"
        onClick={() => setOpen(!open)}
        disabled={disabled || cooldown}
        title="Send Emote"
      >
        {cooldown ? '...' : '\uD83D\uDE00 Emote'}
      </button>

      {open && (
        <div className="emote-wheel-overlay">
          <div className="emote-wheel-backdrop" onClick={() => setOpen(false)} />
          <div className="emote-wheel">
            {EMOTES.map((emote, i) => {
              const angle = (i * (2 * Math.PI)) / EMOTES.length - Math.PI / 2;
              const x = centerX + radius * Math.cos(angle) - 28;
              const y = centerY + radius * Math.sin(angle) - 28;
              return (
                <div
                  key={emote.id}
                  className="emote-item"
                  style={{ left: `${x}px`, top: `${y}px` }}
                  onClick={() => sendEmote(emote.id)}
                >
                  <span className="emote-item-icon">{emote.icon}</span>
                  <span className="emote-item-label">{emote.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
