import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useTableStore } from '../../store/tableStore';
import { useTournamentSeatStore } from '../../store/tournamentSeatStore';
// 2026-10-23 review fix-up (owner: "Turn all off") — no coach whispers while
// any of his tables is a qualifier table (a whisper names no table).
import { helpToolsOffAtAnyTable } from '../../utils/qualifierHelpTools';
import './CoachingRail.css';

// A `coachWhisper` frame carries no table id: poker-server relays it from ANY
// `table:` room this socket shares with the sender. With a qualifier seat AND
// an extra cash tab on screen (where this rail can be open), a whisper sent
// from the QUALIFIER table's room would show here. So while one of his tables
// (on screen, multi-table entry, live tournament seat) is a qualifier table,
// no whisper is shown at all. Never throws (a store read that fails shows it,
// as before).
function whispersOffNow() {
  try {
    const t = useTableStore.getState();
    const seat = useTournamentSeatStore.getState().seat;
    return helpToolsOffAtAnyTable(t.gameState, t.activeTables, seat);
  } catch {
    return false;
  }
}

// R1 (TABLEUI-3, 2026-10-11) — the rail sits just BELOW the table's top bar
// (.hud-top), whatever its height: on phones that bar wraps to ~140px, and at
// the fixed top: 52/60px the rail's controls (pointer-events on, z 900) covered
// Sit Out / Options / Back. The CSS top stays as the fallback.
function useBelowTopBar(active) {
  const [topPx, setTopPx] = useState(null);
  useLayoutEffect(() => {
    if (!active) return undefined;
    const measure = () => {
      const bar = document.querySelector('.hud-top');
      if (!bar) return;
      const b = bar.getBoundingClientRect();
      if (b.height <= 0) return;
      const v = Math.round(b.bottom + 6);
      setTopPx((prev) => (prev === v ? prev : v));
    };
    measure();
    let ro = null;
    try {
      const bar = document.querySelector('.hud-top');
      if (bar && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(bar); }
    } catch { /* fallback: CSS top */ }
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); if (ro) ro.disconnect(); };
  }, [active]);
  return topPx;
}

// ─── AI tip generator ────────────────────────────────────────────────────────

function generateAITip({ gameState, equity, isMyTurn }) {
  const tips = [];

  if (isMyTurn && equity !== null && equity !== undefined) {
    if (equity < 20) {
      tips.push('Very low equity. This is a clear fold unless you\'re on a strong draw.');
    } else if (equity < 35) {
      tips.push('Weak equity. Check or fold unless you have a good bluff candidate.');
    } else if (equity >= 45 && equity <= 65) {
      const isIP = gameState?.isInPosition ?? false;
      tips.push(
        `Marginal spot. Position matters here — ${
          isIP ? 'you have the advantage' : 'be cautious OOP'
        }.`
      );
    } else if (equity > 65) {
      const potOdds = gameState?.potOdds ?? 33;
      tips.push(`Strong hand. Consider a value bet of ${potOdds}% pot.`);
    }
  }

  if (gameState?.pot > 5000) {
    tips.push('Large pot alert — pot control becomes important.');
  }

  if (gameState?.street === 'river' && isMyTurn) {
    tips.push('Final street — no more cards to improve. Pure value or bluff decision.');
  }

  if (gameState?.street === 'preflop' && gameState?.facingRaise) {
    tips.push('3-bet candidates: premium pairs + AKs. Calling range: suited connectors, small pairs.');
  }

  return tips.length > 0 ? tips[0] : null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CoachingRail({
  gameState = {},
  yourCards = [],
  equity = null,
  isMyTurn = false,
  socket = null,
  visible = true,
  onClose,
}) {
  const [messages, setMessages] = useState([]); // { id, text, source, coach, ts, dismissing }
  const [coachMode, setCoachMode] = useState('ai'); // 'ai' | 'human' | 'off'

  const dismissTimers = useRef({});
  const prevGameStateRef = useRef(null);
  const messageIdCounter = useRef(0);

  // ── Add message helper ────────────────────────────────────────────────────

  const addMessage = useCallback(({ text, source = 'ai', coach = 'AI Coach' }) => {
    const id = ++messageIdCounter.current;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMessages(prev => {
      const next = [...prev, { id, text, source, coach, ts, dismissing: false }];
      // Keep max 3 visible — mark the oldest as dismissing if over limit
      if (next.length > 3) {
        next[0] = { ...next[0], dismissing: true };
      }
      return next;
    });

    // Auto-dismiss after 8 s
    dismissTimers.current[id] = setTimeout(() => {
      setMessages(prev =>
        prev.map(m => (m.id === id ? { ...m, dismissing: true } : m))
      );
      // Remove from DOM after fade-out (400 ms)
      setTimeout(() => {
        setMessages(prev => prev.filter(m => m.id !== id));
        delete dismissTimers.current[id];
      }, 400);
    }, 8000);
  }, []);

  // ── Manual dismiss ────────────────────────────────────────────────────────

  const dismissMessage = useCallback((id) => {
    clearTimeout(dismissTimers.current[id]);
    delete dismissTimers.current[id];
    setMessages(prev =>
      prev.map(m => (m.id === id ? { ...m, dismissing: true } : m))
    );
    setTimeout(() => {
      setMessages(prev => prev.filter(m => m.id !== id));
    }, 400);
  }, []);

  // ── Socket: human coach whispers ──────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;
    const handler = ({ message, coachName } = {}) => {
      if (whispersOffNow()) {
        // eslint-disable-next-line no-console
        console.info('[CoachingRail] coach whisper not shown: a qualifier table is open');
        return;
      }
      addMessage({ text: message, source: 'human', coach: coachName || 'Coach' });
    };
    socket.on('coachWhisper', handler);
    return () => socket.off('coachWhisper', handler);
  }, [socket, addMessage]);

  // ── AI coach: watch gameState changes ────────────────────────────────────

  useEffect(() => {
    if (coachMode !== 'ai') return;

    const prev = prevGameStateRef.current;
    const hasChanged =
      !prev ||
      prev.street !== gameState?.street ||
      prev.pot !== gameState?.pot ||
      prev.facingRaise !== gameState?.facingRaise;

    const turnJustStarted = isMyTurn && (!prev || !prev.isMyTurn);

    if (hasChanged || turnJustStarted) {
      const tip = generateAITip({ gameState, equity, isMyTurn });
      if (tip) addMessage({ text: tip, source: 'ai', coach: 'AI Coach' });
    }

    prevGameStateRef.current = { ...gameState, isMyTurn };
  }, [gameState, equity, isMyTurn, coachMode, addMessage]);

  // ── Cleanup timers on unmount ─────────────────────────────────────────────

  useEffect(() => {
    return () => {
      Object.values(dismissTimers.current).forEach(clearTimeout);
    };
  }, []);

  // ── Filter messages by mode ───────────────────────────────────────────────

  const visibleMessages = messages.filter(m => {
    if (coachMode === 'ai') return m.source === 'ai';
    if (coachMode === 'human') return m.source === 'human';
    return false; // 'off' — nothing shown (but socket still listens above)
  });

  const railTop = useBelowTopBar(visible);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!visible) return null;

  return (
    <div className="coaching-rail" style={railTop != null ? { top: railTop } : undefined}>
      {/* Mode toggle */}
      <div className="coaching-rail__controls">
        <span className="coaching-rail__label">Coach Mode</span>
        <div className="coaching-rail__toggle">
          {['ai', 'human', 'off'].map(mode => (
            <button
              key={mode}
              className={`coaching-rail__pill${coachMode === mode ? ' coaching-rail__pill--active' : ''}`}
              onClick={() => setCoachMode(mode)}
            >
              {mode === 'ai' ? 'AI' : mode === 'human' ? 'Human' : 'Off'}
            </button>
          ))}
        </div>
        {onClose && (
          <button className="coaching-rail__close" onClick={onClose} aria-label="Close coach rail">
            ×
          </button>
        )}
      </div>

      {/* Message cards */}
      <div className="coaching-rail__messages">
        {coachMode !== 'off' && visibleMessages.map(msg => (
          <div
            key={msg.id}
            className={`coaching-whisper-card${msg.dismissing ? ' coaching-whisper-card--dismissing' : ''}`}
          >
            <div className="coaching-whisper-card__avatar">🎓</div>
            <div className="coaching-whisper-card__body">
              <div className="coaching-whisper-card__meta">
                <span className="coaching-whisper-card__coach">{msg.coach}</span>
                <span className="coaching-whisper-card__ts">{msg.ts}</span>
              </div>
              <p className="coaching-whisper-card__text">{msg.text}</p>
            </div>
            <button
              className="coaching-whisper-card__dismiss"
              onClick={() => dismissMessage(msg.id)}
              aria-label="Dismiss tip"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
