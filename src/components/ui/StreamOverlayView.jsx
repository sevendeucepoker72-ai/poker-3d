import { useState, useEffect, useRef } from 'react';
import { connectToServer, getSocket } from '../../services/socketService';
import './StreamOverlay.css';

// 2026-06-18 — Phase 3g: a REAL OBS browser-source overlay. Renders a clean,
// transparent broadcast graphic of a live table driven by the actual
// spectator game state from poker-server (board, pot, blinds, stacks, dealer,
// active seat, showdown). No fake streaming infra. Two modes:
//   • Spectate: given a tableId, connects anonymously, emits `spectate`, merges
//     the gameState delta protocol, and (optionally) holds the render back by
//     `delay` seconds to match a streamer's broadcast delay.
//   • Preview: given `previewState`, renders directly with no socket (used by
//     the control panel's live preview).
// Hole cards are NEVER shown except at showdown — spectator state hides them,
// so a streamer's hand can't be sniped through the overlay.

const THEMES = {
  sapphire: { accent: '#ffd24a', glass: 'rgba(12,26,68,.82)', line: 'rgba(120,160,255,.34)', ink: '#eaf1ff' },
  emerald:  { accent: '#27e0a0', glass: 'rgba(6,30,24,.82)',  line: 'rgba(80,220,170,.34)', ink: '#eafff7' },
  noir:     { accent: '#ffd24a', glass: 'rgba(10,10,16,.86)', line: 'rgba(255,255,255,.18)', ink: '#f3f3f7' },
};

function isRed(card) {
  if (!card) return false;
  if (typeof card.suit === 'number') return card.suit === 0 || card.suit === 1; // Hearts/Diamonds
  const d = String(card.display || card.suit || '');
  return d.includes('♥') || d.includes('♦');
}
function cardText(card) {
  if (!card) return '';
  if (card.display) return card.display;
  return `${card.rank ?? ''}${card.suit ?? ''}`;
}

function OverlayCard({ card }) {
  if (!card) return <span className="sov-card sov-card-empty" />;
  return <span className={`sov-card ${isRed(card) ? 'sov-red' : 'sov-black'}`}>{cardText(card)}</span>;
}

function fmtChips(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
}

export default function StreamOverlayView({ tableId, delaySec = 0, theme = 'sapphire', previewState = null }) {
  const [state, setState] = useState(previewState);
  const mergedRef = useRef(previewState);          // latest merged state (spectate mode)
  const bufferRef = useRef([]);                    // [{ts, state}] for delay
  const t = THEMES[theme] || THEMES.sapphire;

  // ── Preview mode: render whatever the parent hands us, no socket. ──
  useEffect(() => { if (previewState) setState(previewState); }, [previewState]);

  // ── Spectate mode: connect + merge the gameState delta protocol. ──
  useEffect(() => {
    if (previewState || !tableId) return undefined;
    document.body.style.background = 'transparent';
    connectToServer();
    const socket = getSocket();
    if (!socket) return undefined;

    const onGameState = (data) => {
      let next;
      if (data && typeof data === 'object' && 'full' in data) {
        if (data.full) next = data.state;
        else next = mergedRef.current ? { ...mergedRef.current, ...data.delta } : { ...data.delta };
      } else {
        next = data;
      }
      mergedRef.current = next;
      if (delaySec > 0) bufferRef.current.push({ ts: Date.now(), state: next });
      else setState(next);
    };
    const requestSpectate = () => socket.emit('spectate', { tableId });
    socket.on('gameState', onGameState);
    if (socket.connected) requestSpectate(); else socket.on('connect', requestSpectate);

    // Delay buffer drainer — render the most recent state older than `delay`.
    let drainer = null;
    if (delaySec > 0) {
      drainer = setInterval(() => {
        const cutoff = Date.now() - delaySec * 1000;
        const buf = bufferRef.current;
        let chosen = null;
        while (buf.length && buf[0].ts <= cutoff) chosen = buf.shift();
        if (chosen) setState(chosen.state);
      }, 250);
    }
    return () => {
      socket.off('gameState', onGameState);
      socket.off('connect', requestSpectate);
      try { socket.emit('stopSpectating'); } catch { /* ignore */ }
      if (drainer) clearInterval(drainer);
    };
  }, [tableId, delaySec, previewState]);

  const wrapStyle = { '--sov-accent': t.accent, '--sov-glass': t.glass, '--sov-line': t.line, '--sov-ink': t.ink };

  if (!state) {
    return (
      <div className={`sov-root ${previewState ? 'sov-preview' : ''}`} style={wrapStyle}>
        <div className="sov-waiting">Waiting for table…</div>
      </div>
    );
  }

  const seats = (state.seats || []).filter((s) => s && s.playerName);
  const community = state.communityCards || [];
  const winners = state.handResult?.winners || [];
  const winnerSeats = new Set(winners.map((w) => w.seatIndex));
  const isShowdown = state.phase === 'Showdown' || state.phase === 'HandComplete';

  return (
    <div className={`sov-root ${previewState ? 'sov-preview' : ''}`} style={wrapStyle}>
      <div className="sov-card-panel">
        {/* Header */}
        <div className="sov-header">
          <span className="sov-table-name">{state.tableName || 'Live Table'}</span>
          <span className="sov-blinds">
            {state.smallBlind ?? '—'}/{state.bigBlind ?? '—'}
            {state.handNumber ? ` · Hand #${state.handNumber}` : ''}
          </span>
        </div>

        {/* Board + pot */}
        <div className="sov-board">
          {Array.from({ length: 5 }, (_, i) => <OverlayCard key={i} card={community[i] || null} />)}
        </div>
        <div className="sov-pot">POT <strong>{(state.pot ?? 0).toLocaleString()}</strong></div>

        {/* Winner banner */}
        {isShowdown && winners.length > 0 && (
          <div className="sov-winner">
            🏆 {winners.map((w) => w.playerName).join(', ')}
            {winners[0]?.handName ? ` · ${winners[0].handName}` : ''}
          </div>
        )}

        {/* Seats */}
        <div className="sov-seats">
          {seats.map((s) => {
            const active = s.seatIndex === state.activeSeatIndex && !isShowdown;
            const dealer = s.seatIndex === state.dealerButtonSeat;
            const won = winnerSeats.has(s.seatIndex);
            return (
              <div key={s.seatIndex} className={`sov-seat ${s.folded ? 'sov-folded' : ''} ${active ? 'sov-active' : ''} ${won ? 'sov-won' : ''}`}>
                <div className="sov-seat-top">
                  {dealer && <span className="sov-dealer">D</span>}
                  <span className="sov-seat-name">{s.playerName}</span>
                  {s.allIn && <span className="sov-allin">ALL-IN</span>}
                </div>
                <div className="sov-seat-stack">{fmtChips(s.chipCount)}</div>
                {s.currentBet > 0 && <div className="sov-seat-bet">bet {fmtChips(s.currentBet)}</div>}
                {/* Hole cards only ever present at showdown for non-folded seats */}
                {isShowdown && s.holeCards && (
                  <div className="sov-seat-cards">
                    {s.holeCards.map((c, i) => <OverlayCard key={i} card={c} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
