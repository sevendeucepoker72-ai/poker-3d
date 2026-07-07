import { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../../services/socketService';
import { useGameStore } from '../../store/gameStore';
import './SocialBracket.css';

// 2026-06-18 — Phase 3d: real, durable, LIVE social brackets backed by
// poker-server (Postgres + a socket room per bracket). Replaces the local-only
// mock: eliminations and side bets now persist and sync to everyone viewing
// the bracket, and the `?bracket=<id>` share link actually loads it.
//   emit  createSocialBracket { bracketId, name, theme, players }
//         getSocialBracket    { bracketId }
//         socialBracketEliminate { bracketId, playerName }
//         placeSocialSideBet  { bracketId, target, amount }
//   recv  socialBracketState  { bracketId, name, theme, status, createdBy, players[], sideBets[] }
//         socialBracketRole   { bracketId, isOrganizer }
//         socialBracketError  { message }

function generateBracketId() {
  // Random 8-char A-Z0-9 id (matches the server's /^[A-Z0-9]{4,16}$/ gate).
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const THEMES = [
  { id: 'neon', label: '🌟 Neon Vegas', accent: '#ffd24a' },
  { id: 'classic', label: '♠ Classic', accent: '#F59E0B' },
  { id: 'western', label: '🤠 Western', accent: '#D97706' },
];

function SideBetModal({ players, accent, available, onClose, onPlace }) {
  const [target, setTarget] = useState(players[0] || '');
  const [amount, setAmount] = useState(500);
  // Chip side bets move REAL play-money now (server deducts atomically), so
  // block a submit the server would only reject: below the 100 minimum or
  // above the player's balance.
  const tooLow = amount < 100;
  const tooHigh = amount > available;
  const invalid = !target || tooLow || tooHigh;
  return (
    <div className="sbet-overlay" onClick={onClose}>
      <div className="sbet-modal" onClick={e => e.stopPropagation()}>
        <div className="sbet-title">💰 Place Side Bet</div>
        <label className="sbet-label">Bet on</label>
        <select className="sbet-select" value={target} onChange={e => setTarget(e.target.value)}>
          {players.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="sbet-label">Amount (chips)</label>
        <input className="sbet-input" type="number" min={100} step={100} value={amount} onChange={e => setAmount(Number(e.target.value))} />
        <div className="sbet-balance">
          Available: {available.toLocaleString()} chips
          {tooHigh && <span className="sbet-balance-warn"> — not enough chips</span>}
        </div>
        <div className="sbet-btns">
          <button className="sbet-btn sbet-btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="sbet-btn sbet-btn--confirm"
            style={{ background: accent, opacity: invalid ? 0.5 : 1 }}
            disabled={invalid}
            onClick={() => { if (!invalid) { onPlace({ target, amount }); onClose(); } }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_ROSTER = 'Player 1\nPlayer 2\nPlayer 3\nPlayer 4\nPlayer 5\nPlayer 6';

export default function SocialBracket({ socket: socketProp, onClose }) {
  const socket = socketProp || getSocket();

  // Real play-chip balance + sign-in status (GAP 24). Side bets now move real
  // play-money: the server deducts on placement and settles parimutuel on
  // bracket completion. Guests are rejected server-side; we hide the form for
  // them and reflect the live balance in the form + on settlement.
  const chips = useGameStore((s) => s.chips);
  const setChips = useGameStore((s) => s.setChips);
  const isLoggedIn = useGameStore((s) => s.isLoggedIn);
  const availableChips = typeof chips === 'number' ? chips : 0;

  // Create-form state
  const [bracketName, setBracketName] = useState('Home Game Showdown');
  const [playerList, setPlayerList] = useState(DEFAULT_ROSTER);
  const [theme, setTheme] = useState('neon');

  // Live server state
  const [serverState, setServerState] = useState(null); // BracketState | null
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showSideBet, setShowSideBet] = useState(false);

  const activeTheme = THEMES.find(t => t.id === (serverState?.theme || theme)) || THEMES[0];

  // ─── Subscribe to live bracket updates ──────────────────────────────────
  useEffect(() => {
    if (!socket) return undefined;
    const onState = (state) => { setServerState(state); setLoading(false); };
    const onRole = (d) => { if (d?.isOrganizer != null) setIsOrganizer(!!d.isOrganizer); };
    const onErr = (d) => { setNotice(d?.message || 'Something went wrong'); setLoading(false); };
    // GAP 24 — placement confirmation: server escrowed the chips atomically.
    const onPlaced = (d) => {
      setNotice(`Bet placed: ${(d?.amount || 0).toLocaleString()} chips escrowed`);
    };
    // GAP 24 — settlement: server credits winnings / refunds and sends the
    // player's NEW balance. Sync the local wallet + toast the result.
    const onSettled = (d) => {
      if (d && typeof d.chips === 'number') setChips(d.chips);
      const amt = (d?.amount || 0).toLocaleString();
      setNotice(d?.won
        ? `Your bracket side bet hit! +${amt} chips`
        : `Side bet refunded: +${amt} chips`);
    };
    socket.on('socialBracketState', onState);
    socket.on('socialBracketRole', onRole);
    socket.on('socialBracketError', onErr);
    socket.on('socialSideBetPlaced', onPlaced);
    socket.on('socialSideBetSettled', onSettled);

    // Share-link viewer: ?bracket=ID auto-loads that bracket.
    // 2026-07-06 audit P2 — on a COLD page load from a share link the socket
    // isn't connected yet, so the old `&& socket.connected` guard silently
    // no-op'd and the bracket never loaded. Emit now if already connected, else
    // load on the next 'connect' (also refreshes after a reconnect).
    const urlId = new URLSearchParams(window.location.search).get('bracket');
    let onConnectLoad = null;
    if (urlId) {
      const bracketId = urlId.toUpperCase();
      const emitLoad = () => { setLoading(true); socket.emit('getSocialBracket', { bracketId }); };
      if (socket.connected) emitLoad();
      else { onConnectLoad = emitLoad; socket.on('connect', onConnectLoad); }
    }
    return () => {
      socket.off('socialBracketState', onState);
      socket.off('socialBracketRole', onRole);
      socket.off('socialBracketError', onErr);
      socket.off('socialSideBetPlaced', onPlaced);
      socket.off('socialSideBetSettled', onSettled);
      if (onConnectLoad) socket.off('connect', onConnectLoad);
    };
  }, [socket, setChips]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(t);
  }, [notice]);

  const handleCreate = useCallback(() => {
    const parsed = playerList.split('\n').map(s => s.trim()).filter(Boolean);
    if (parsed.length < 2 || !socket?.connected) return;
    const id = generateBracketId();
    setLoading(true);
    setIsOrganizer(true);
    socket.emit('createSocialBracket', { bracketId: id, name: bracketName, theme, players: parsed });
  }, [playerList, bracketName, theme, socket]);

  const handleEliminate = useCallback((playerName) => {
    if (!serverState || !socket?.connected) return;
    socket.emit('socialBracketEliminate', { bracketId: serverState.bracketId, playerName });
  }, [serverState, socket]);

  const handleSideBet = useCallback(({ target, amount }) => {
    if (!serverState || !socket?.connected) return;
    socket.emit('placeSocialSideBet', { bracketId: serverState.bracketId, target, amount });
  }, [serverState, socket]);

  const shareLink = serverState ? `${window.location.origin}?bracket=${serverState.bracketId}` : '';
  const handleCopyLink = () => {
    if (!shareLink) return;
    navigator.clipboard?.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const newTournament = () => { setServerState(null); setIsOrganizer(false); };

  // ─── Derived bracket data ───────────────────────────────────────────────
  const players = serverState?.players || [];
  const activePlayers = players.filter(p => !p.out);
  const eliminated = players.filter(p => p.out).sort((a, b) => (b.outOrder || 0) - (a.outOrder || 0));
  const isComplete = serverState?.status === 'complete';
  const champion = isComplete && activePlayers.length === 1 ? activePlayers[0] : null;
  const isHeadsUp = !champion && activePlayers.length === 2;
  const isFinalThree = !champion && activePlayers.length === 3;
  const view = serverState ? 'bracket' : 'create';

  return (
    <div className="social-bracket-overlay" onClick={onClose}>
      <div className={`social-bracket-modal sb-theme-${activeTheme.id}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sb-header" style={{ borderBottomColor: activeTheme.accent + '44' }}>
          <span className="sb-logo">🏆</span>
          <span className="sb-title" style={{ color: activeTheme.accent }}>
            {view === 'bracket' ? serverState.name : 'Social Bracket Tournaments'}
          </span>
          {view === 'bracket' && (
            <span className="sb-id-badge">#{serverState.bracketId}</span>
          )}
          <button className="sb-close" onClick={onClose}>×</button>
        </div>

        {notice && <div className="sb-notice">{notice}</div>}

        {/* Create form */}
        {view === 'create' && (
          <div className="sb-create-form">
            {loading && <div className="sb-loading">Loading…</div>}
            <div className="sb-field">
              <label className="sb-label">Tournament Name</label>
              <input
                className="sb-input"
                value={bracketName}
                onChange={e => setBracketName(e.target.value)}
                placeholder="e.g. Home Game Friday Night"
                maxLength={80}
              />
            </div>

            <div className="sb-field">
              <label className="sb-label">Theme</label>
              <div className="sb-theme-row">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    className={`sb-theme-btn ${theme === t.id ? 'sb-theme-btn--active' : ''}`}
                    style={theme === t.id ? { borderColor: t.accent, color: t.accent } : {}}
                    onClick={() => setTheme(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sb-field">
              <label className="sb-label">Players (one per line, min 2)</label>
              <textarea
                className="sb-textarea"
                value={playerList}
                onChange={e => setPlayerList(e.target.value)}
                rows={6}
                placeholder="Enter player names, one per line..."
              />
              <div className="sb-player-count">
                {playerList.split('\n').filter(s => s.trim()).length} players
              </div>
            </div>

            <button
              className="sb-create-btn"
              style={{ background: activeTheme.accent, color: '#0a0a1a' }}
              onClick={handleCreate}
              disabled={loading || playerList.split('\n').filter(s => s.trim()).length < 2}
            >
              Create Bracket
            </button>
          </div>
        )}

        {/* Live bracket view */}
        {view === 'bracket' && (
          <div className="sb-bracket-view">
            {/* Share link */}
            <div className="sb-share-row">
              <span className="sb-share-label">Share link:</span>
              <input className="sb-share-input" value={shareLink} readOnly />
              <button className="sb-copy-btn" style={{ color: activeTheme.accent }} onClick={handleCopyLink}>
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>

            {/* Status banner */}
            {champion && (
              <div className="sb-champion-banner" style={{ borderColor: activeTheme.accent }}>
                <span style={{ fontSize: '1.8rem' }}>🏆</span>
                <div>
                  <div className="sb-champion-label">CHAMPION</div>
                  <div className="sb-champion-name" style={{ color: activeTheme.accent }}>{champion.name}</div>
                </div>
              </div>
            )}
            {isHeadsUp && (
              <div className="sb-status-badge sb-status-badge--headsup">⚔️ Heads-Up!</div>
            )}
            {isFinalThree && (
              <div className="sb-status-badge sb-status-badge--final3">🎯 Final 3</div>
            )}

            {/* Active players */}
            <div className="sb-section-label" style={{ color: activeTheme.accent }}>
              Active — {activePlayers.length} remaining{!isOrganizer && ' · viewing'}
            </div>
            <div className="sb-players-grid">
              {activePlayers.map((p, i) => (
                <div key={p.name} className="sb-player-card">
                  <div className="sb-player-rank">#{i + 1}</div>
                  <div className="sb-player-avatar" style={{ background: activeTheme.accent + '33', color: activeTheme.accent }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="sb-player-name">{p.name}</div>
                  {isOrganizer && !champion && (
                    <button
                      className="sb-elim-btn"
                      onClick={() => handleEliminate(p.name)}
                      title="Eliminate"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Eliminated */}
            {eliminated.length > 0 && (
              <>
                <div className="sb-section-label sb-section-label--elim">
                  Eliminated — {eliminated.length} out
                </div>
                <div className="sb-elim-list">
                  {eliminated.map((p, i) => (
                    <span key={p.name} className="sb-elim-pill">
                      #{activePlayers.length + i + 1} {p.name}
                    </span>
                  ))}
                </div>
              </>
            )}

            {/* Side bets */}
            <div className="sb-sidebets-row">
              <div className="sb-section-label" style={{ color: activeTheme.accent, marginBottom: 0 }}>
                Side Bets
              </div>
              {!champion && (
                isLoggedIn ? (
                  <button
                    className="sb-sidebet-add-btn"
                    style={{ borderColor: activeTheme.accent + '66', color: activeTheme.accent }}
                    onClick={() => setShowSideBet(true)}
                  >
                    + Add Bet
                  </button>
                ) : (
                  <span className="sb-signin-hint">Sign in to place a chip side bet</span>
                )
              )}
            </div>
            {(serverState.sideBets || []).length === 0 ? (
              <div className="sb-no-bets">No side bets yet</div>
            ) : (
              <div className="sb-bets-list">
                {serverState.sideBets.map((bet, idx) => {
                  const targetOut = players.find(p => p.name === bet.target)?.out;
                  // Prefer the REAL server settlement when present: the bracket
                  // has been settled and this row carries settled/payout. A
                  // positive payout = won (parimutuel winnings) or refunded; a
                  // zero payout on a settled row = lost. Falls back to the
                  // cosmetic champion/eliminated inference only pre-settlement.
                  const settled = serverState.sidebetsSettled || bet.settled;
                  const payout = typeof bet.payout === 'number' ? bet.payout : null;
                  return (
                    <div key={idx} className="sb-bet-row">
                      <span className="sb-bet-bettor">{bet.bettor}</span>
                      <span className="sb-bet-arrow">→</span>
                      <span className="sb-bet-target" style={{ color: activeTheme.accent }}>{bet.target}</span>
                      <span className="sb-bet-amount">+{bet.amount.toLocaleString()}</span>
                      {settled ? (
                        payout && payout > 0 ? (
                          <span className="sb-bet-result sb-bet-result--won">+{payout.toLocaleString()}</span>
                        ) : (
                          <span className="sb-bet-result sb-bet-result--lost">Lost</span>
                        )
                      ) : (
                        <>
                          {champion?.name === bet.target && (
                            <span className="sb-bet-result sb-bet-result--won">Won!</span>
                          )}
                          {!champion && targetOut && (
                            <span className="sb-bet-result sb-bet-result--lost">Lost</span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button className="sb-new-btn" onClick={newTournament}>
              ← New Tournament
            </button>
          </div>
        )}

        {showSideBet && (
          <SideBetModal
            players={activePlayers.map(p => p.name)}
            accent={activeTheme.accent}
            available={availableChips}
            onClose={() => setShowSideBet(false)}
            onPlace={handleSideBet}
          />
        )}
      </div>
    </div>
  );
}
