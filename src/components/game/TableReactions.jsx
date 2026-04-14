import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../../services/socketService';
import { useGameStore } from '../../store/gameStore';
import './TableReactions.css';

const REACTIONS = [
  { id: 'clap', icon: '\uD83D\uDC4F', label: 'Clap' },
  { id: 'laugh', icon: '\uD83D\uDE02', label: 'Laugh' },
  { id: 'cry', icon: '\uD83D\uDE22', label: 'Cry' },
  { id: 'fire', icon: '\uD83D\uDD25', label: 'Fire' },
  { id: 'shock', icon: '\uD83D\uDE31', label: 'Shock' },
  { id: 'gg', icon: '\uD83D\uDC4D', label: 'GG' },
];

export const REACTION_MAP = Object.fromEntries(REACTIONS.map((r) => [r.id, r]));

export default function TableReactions() {
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const cooldownRef = useRef(null);
  const playerName = useGameStore((s) => s.playerName);

  const sendReaction = useCallback((reactionId) => {
    if (cooldown) return;
    const socket = getSocket();
    if (socket) {
      socket.emit('tableReaction', { reactionId });
    }
    setOpen(false);
    setCooldown(true);
    cooldownRef.current = setTimeout(() => setCooldown(false), 2000);
  }, [cooldown]);

  // Listen for incoming reactions from all players
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (data) => {
      if (!data || !data.reactionId) return;
      const reaction = REACTION_MAP[data.reactionId];
      if (!reaction) return;

      const id = Date.now() + Math.random();
      // Offset position based on seatIndex if available
      const seatOffset = (data.seatIndex != null) ? (data.seatIndex / 8) * 400 - 200 : (Math.random() * 200 - 100);

      setFloatingReactions((prev) => [
        ...prev,
        {
          id,
          icon: reaction.icon,
          playerName: data.playerName || 'Player',
          offsetX: seatOffset,
        },
      ]);

      // Remove after animation completes
      setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
      }, 1800);
    };

    socket.on('tableReaction', handler);
    return () => socket.off('tableReaction', handler);
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  return (
    <div className="table-reactions">
      <button
        className="reactions-toggle-btn"
        onClick={() => setOpen(!open)}
        disabled={cooldown}
        title="Table Reactions"
      >
        {cooldown ? '...' : '\uD83D\uDC4F React'}
      </button>

      {open && (
        <div className="reactions-bar">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              className="reaction-btn"
              onClick={() => sendReaction(r.id)}
              title={r.label}
            >
              <span className="reaction-btn-icon">{r.icon}</span>
              <span className="reaction-btn-label">{r.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Floating reactions from all players */}
      {floatingReactions.map((r) => (
        <div
          key={r.id}
          className="table-reaction-float"
          style={{
            top: '35%',
            left: `calc(50% + ${r.offsetX}px)`,
          }}
        >
          <span className="table-reaction-float-icon">{r.icon}</span>
          <span className="table-reaction-float-name">{r.playerName}</span>
        </div>
      ))}
    </div>
  );
}
