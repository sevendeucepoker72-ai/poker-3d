import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../../services/socketService';
import './EmoteWheel.css';

// Per-player emotes (shown at the sender's seat). `emote` socket event.
const EMOTES = [
  { id: 'nice',     icon: '\uD83D\uDC4D', label: 'Nice',     kind: 'emote' },
  { id: 'lol',      icon: '\uD83D\uDE02', label: 'LOL',      kind: 'emote' },
  { id: 'cool',     icon: '\uD83D\uDE0E', label: 'Cool',     kind: 'emote' },
  { id: 'angry',    icon: '\uD83D\uDE21', label: 'Angry',    kind: 'emote' },
  { id: 'thinking', icon: '\uD83E\uDD14', label: 'Thinking', kind: 'emote' },
  { id: 'dead',     icon: '\uD83D\uDC80', label: 'Dead',     kind: 'emote' },
  { id: 'fire',     icon: '\uD83D\uDD25', label: 'Fire',     kind: 'emote' },
  { id: 'gg',       icon: '\uD83D\uDC4F', label: 'GG',       kind: 'emote' },
  // Merged from TableReactions per user request — table-wide reactions
  // (float over the felt, shown to everyone). `tableReaction` event.
  { id: 'clap',  icon: '\uD83D\uDC4F', label: 'Clap',  kind: 'reaction' },
  { id: 'laugh', icon: '\uD83D\uDE02', label: 'Laugh', kind: 'reaction' },
  { id: 'cry',   icon: '\uD83D\uDE22', label: 'Cry',   kind: 'reaction' },
  { id: 'shock', icon: '\uD83D\uDE31', label: 'Shock', kind: 'reaction' },
];

export const EMOTE_MAP = Object.fromEntries(EMOTES.map((e) => [e.id, e]));

export default function EmoteWheel({ disabled }) {
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const cooldownRef = useRef(null);

  const sendEmote = useCallback((emoteId) => {
    if (cooldown) return;
    const socket = getSocket();
    const entry = EMOTE_MAP[emoteId];
    const event = entry?.kind === 'reaction' ? 'tableReaction' : 'emote';
    const payloadKey = entry?.kind === 'reaction' ? 'reactionId' : 'emoteId';
    if (socket) {
      socket.emit(event, { [payloadKey]: emoteId });
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
