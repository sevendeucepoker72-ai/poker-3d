import { useState, useEffect } from 'react';
import './SocialBracket.css';

function generateBracketId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function SideBetModal({ players, onClose, onPlace }) {
  const [bettor, setBettor] = useState('You');
  const [target, setTarget] = useState(players[0] || '');
  const [amount, setAmount] = useState(500);

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
        <div className="sbet-btns">
          <button className="sbet-btn sbet-btn--cancel" onClick={onClose}>Cancel</button>
          <button className="sbet-btn sbet-btn--confirm" onClick={() => { onPlace({ bettor, target, amount }); onClose(); }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

const MOCK_PLAYERS = ['AceKiller99', 'BluffQueen', 'RiverRat42', 'ChipStack', 'PocketRockets', 'FoldEmFiona', 'AllInAnna', 'TightTommy'];

export default function SocialBracket({ socket, onClose }) {
  const [view, setView] = useState('create'); // 'create' | 'bracket'
  const [bracketName, setBracketName] = useState('Home Game Showdown');
  const [playerList, setPlayerList] = useState(MOCK_PLAYERS.slice(0, 6).join('\n'));
  const [bracketId, setBracketId] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [players, setPlayers] = useState([]);
  const [eliminated, setEliminated] = useState([]);
  const [sideBets, setSideBets] = useState([]);
  const [showSideBet, setShowSideBet] = useState(false);
  const [theme, setTheme] = useState('neon'); // 'neon' | 'classic' | 'western'

  const THEMES = [
    { id: 'neon', label: '🌟 Neon Vegas', accent: '#00D9FF' },
    { id: 'classic', label: '♠ Classic', accent: '#F59E0B' },
    { id: 'western', label: '🤠 Western', accent: '#D97706' },
  ];
  const activeTheme = THEMES.find(t => t.id === theme) || THEMES[0];

  function handleCreate() {
    const parsed = playerList.split('\n').map(s => s.trim()).filter(Boolean);
    if (parsed.length < 2) return;
    const id = generateBracketId();
    setBracketId(id);
    setPlayers(parsed.map((name, i) => ({ name, chips: 10000, rank: i + 1, out: false })));
    setEliminated([]);
    setShareLink(`${window.location.origin}?bracket=${id}`);
    setView('bracket');

    if (socket) {
      socket.emit('createSocialBracket', { bracketId: id, name: bracketName, players: parsed });
    }
  }

  function handleEliminate(playerName) {
    setPlayers(prev => prev.map(p => p.name === playerName ? { ...p, out: true, chips: 0 } : p));
    setEliminated(prev => [playerName, ...prev]);
    if (socket) socket.emit('socialBracketEliminate', { bracketId, playerName });
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSideBet(bet) {
    setSideBets(prev => [...prev, { ...bet, id: Date.now(), settled: false }]);
  }

  const activePlayers = players.filter(p => !p.out);
  const isHeadsUp = activePlayers.length === 2;
  const isFinalThree = activePlayers.length === 3;
  const champion = activePlayers.length === 1 ? activePlayers[0] : null;

  return (
    <div className="social-bracket-overlay" onClick={onClose}>
      <div className={`social-bracket-modal sb-theme-${theme}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sb-header" style={{ borderBottomColor: activeTheme.accent + '44' }}>
          <span className="sb-logo">🏆</span>
          <span className="sb-title" style={{ color: activeTheme.accent }}>
            {view === 'bracket' ? bracketName : 'Social Bracket Tournaments'}
          </span>
          {view === 'bracket' && bracketId && (
            <span className="sb-id-badge">#{bracketId}</span>
          )}
          <button className="sb-close" onClick={onClose}>×</button>
        </div>

        {/* Create form */}
        {view === 'create' && (
          <div className="sb-create-form">
            <div className="sb-field">
              <label className="sb-label">Tournament Name</label>
              <input
                className="sb-input"
                value={bracketName}
                onChange={e => setBracketName(e.target.value)}
                placeholder="e.g. Home Game Friday Night"
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
              disabled={playerList.split('\n').filter(s => s.trim()).length < 2}
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
            {!champion && isHeadsUp && (
              <div className="sb-status-badge sb-status-badge--headsup">⚔️ Heads-Up!</div>
            )}
            {!champion && isFinalThree && (
              <div className="sb-status-badge sb-status-badge--final3">🎯 Final 3</div>
            )}

            {/* Active players */}
            <div className="sb-section-label" style={{ color: activeTheme.accent }}>
              Active — {activePlayers.length} remaining
            </div>
            <div className="sb-players-grid">
              {activePlayers.map((p, i) => (
                <div key={p.name} className="sb-player-card">
                  <div className="sb-player-rank">#{i + 1}</div>
                  <div className="sb-player-avatar" style={{ background: activeTheme.accent + '33', color: activeTheme.accent }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="sb-player-name">{p.name}</div>
                  <button
                    className="sb-elim-btn"
                    onClick={() => handleEliminate(p.name)}
                    title="Eliminate"
                  >
                    ✕
                  </button>
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
                  {eliminated.map((name, i) => (
                    <span key={name} className="sb-elim-pill">
                      #{activePlayers.length + i + 1} {name}
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
              <button
                className="sb-sidebet-add-btn"
                style={{ borderColor: activeTheme.accent + '66', color: activeTheme.accent }}
                onClick={() => setShowSideBet(true)}
              >
                + Add Bet
              </button>
            </div>
            {sideBets.length === 0 ? (
              <div className="sb-no-bets">No side bets yet</div>
            ) : (
              <div className="sb-bets-list">
                {sideBets.map(bet => (
                  <div key={bet.id} className="sb-bet-row">
                    <span className="sb-bet-bettor">{bet.bettor}</span>
                    <span className="sb-bet-arrow">→</span>
                    <span className="sb-bet-target" style={{ color: activeTheme.accent }}>{bet.target}</span>
                    <span className="sb-bet-amount">+{bet.amount.toLocaleString()}</span>
                    {!bet.settled && eliminated.includes(bet.target) && (
                      <span className="sb-bet-result sb-bet-result--lost">Lost</span>
                    )}
                    {!bet.settled && champion?.name === bet.target && (
                      <span className="sb-bet-result sb-bet-result--won">Won!</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button className="sb-new-btn" onClick={() => setView('create')}>
              ← New Tournament
            </button>
          </div>
        )}

        {showSideBet && (
          <SideBetModal
            players={activePlayers.map(p => p.name)}
            onClose={() => setShowSideBet(false)}
            onPlace={handleSideBet}
          />
        )}
      </div>
    </div>
  );
}
