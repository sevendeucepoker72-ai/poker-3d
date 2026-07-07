import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import './TournamentLobby.css';

const TOURNAMENT_ICONS = {
  'Freeroll': '\uD83C\uDFAF',
  'Daily 5K': '\uD83D\uDCB0',
  'High Stakes': '\uD83D\uDC8E',
};

export default function TournamentLobby() {
  const [tournaments, setTournaments] = useState([]);
  const [registeredIds, setRegisteredIds] = useState(new Set());
  // Live paused-state per running tournament, driven by the server's
  // `tournamentPaused` / `tournamentResumed` broadcasts (GAP 15). Only
  // meaningful for the admin TD controls below.
  const [pausedIds, setPausedIds] = useState(new Set());
  const playerName = useGameStore((s) => s.playerName);
  const setScreen = useGameStore((s) => s.setScreen);
  // Admin flag (set from the server's loginResult userData). Server enforces
  // the actual privilege on every TD control emit; this only gates the UI.
  const isAdmin = useGameStore((s) => s.isAdmin);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('getTournaments');

    const handleList = (list) => setTournaments(list);
    const handleRegistered = (data) => {
      setRegisteredIds((prev) => new Set([...prev, data.tournamentId]));
    };
    const handleStarted = (data) => {
      setScreen('table');
    };
    // GAP 15 — reflect live pause state pushed to the tournament's table rooms.
    const handlePaused = (data) => {
      if (!data?.tournamentId) return;
      setPausedIds((prev) => new Set([...prev, data.tournamentId]));
    };
    const handleResumed = (data) => {
      if (!data?.tournamentId) return;
      setPausedIds((prev) => {
        const next = new Set(prev);
        next.delete(data.tournamentId);
        return next;
      });
    };
    // Withdraw confirmation from the server — drop the registration locally and
    // surface any entry-fee refund. Server only allows this while 'registering'.
    const handleUnregistered = (data) => {
      setRegisteredIds((prev) => {
        const next = new Set(prev);
        next.delete(data.tournamentId);
        return next;
      });
      socket.emit('getTournaments');
    };

    socket.on('tournamentList', handleList);
    socket.on('tournamentRegistered', handleRegistered);
    socket.on('tournamentUnregistered', handleUnregistered);
    socket.on('tournamentStarted', handleStarted);
    socket.on('tournamentPaused', handlePaused);
    socket.on('tournamentResumed', handleResumed);

    const interval = setInterval(() => socket.emit('getTournaments'), 5000);

    return () => {
      socket.off('tournamentList', handleList);
      socket.off('tournamentRegistered', handleRegistered);
      socket.off('tournamentUnregistered', handleUnregistered);
      socket.off('tournamentStarted', handleStarted);
      socket.off('tournamentPaused', handlePaused);
      socket.off('tournamentResumed', handleResumed);
      clearInterval(interval);
    };
  }, [setScreen]);

  const handleRegister = (tournamentId) => {
    const socket = getSocket();
    if (!socket || !playerName) return;
    socket.emit('registerTournament', { tournamentId, playerName });
  };

  const handleWithdraw = (tournamentId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('leaveTournament', { tournamentId });
  };

  // ── GAP 15: live TD controls (admin-only; server enforces the privilege) ──
  const handleTogglePause = (tournamentId, paused) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('pauseTournament', { tournamentId, paused });
  };
  const handleAdvanceLevel = (tournamentId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('advanceTournamentLevel', { tournamentId });
  };
  const handleRebalance = (tournamentId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('rebalanceTournament', { tournamentId });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const diff = timestamp - Date.now();
    if (diff <= 0) return 'Starting soon...';
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  if (tournaments.length === 0) return null;

  return (
    <div className="tournament-section">
      <h2>Tournaments</h2>
      <div className="tournament-grid">
        {tournaments.map((t) => {
          const isRegistered = registeredIds.has(t.tournamentId);
          const icon = TOURNAMENT_ICONS[t.name] || '\uD83C\uDFC6';
          // Prefer the server's authoritative paused flag from the polled list
          // (an admin in the LOBBY isn't in the tournament's table room, so the
          // tournamentPaused echo alone never reaches them); the echo just gives
          // instant feedback between 5s polls.
          const isPaused = !!t.paused || pausedIds.has(t.tournamentId);

          return (
            <div
              key={t.tournamentId}
              className={`tournament-card ${t.status}`}
            >
              <div className="tournament-icon">{icon}</div>

              <div className="tournament-info">
                <div className="tournament-name">
                  {t.name}
                  <span
                    className={`tournament-status-badge ${t.status}`}
                    style={{ marginLeft: '8px' }}
                  >
                    {t.status}
                  </span>
                </div>

                <div className="tournament-details">
                  <div className="tournament-detail">
                    <span className="tournament-detail-label">Buy-in:</span>
                    <span className="tournament-detail-value">
                      {t.buyIn === 0 ? 'Free' : t.buyIn.toLocaleString()}
                    </span>
                  </div>
                  <div className="tournament-detail">
                    <span className="tournament-detail-label">Prize:</span>
                    {/* Show the REAL payable pool: freerolls are house-funded to
                        the advertised amount; buy-in events show the live funded
                        pool (grows as players register). Falls back to the
                        advertised prizePool if an older server omits fundedPool. */}
                    <span className="tournament-detail-value">
                      {(t.fundedPool ?? t.prizePool ?? 0).toLocaleString()}
                      {t.isFreeroll ? ' (freeroll)' : ''}
                    </span>
                  </div>
                  <div className="tournament-detail">
                    <span className="tournament-detail-label">Players:</span>
                    <span className="tournament-detail-value">
                      {t.registeredPlayers}/{t.maxPlayers}
                    </span>
                  </div>
                  {t.currentBlinds && (
                    <div className="tournament-detail">
                      <span className="tournament-detail-label">Blinds:</span>
                      <span className="tournament-detail-value">
                        {t.currentBlinds.sb}/{t.currentBlinds.bb}
                      </span>
                    </div>
                  )}
                </div>

                {t.nextStartTime > 0 && t.status === 'registering' && (
                  <div className="tournament-timer">Starts in: {formatTime(t.nextStartTime)}</div>
                )}

                {t.currentBlinds && (
                  <div className="tournament-blinds-info">
                    Level {t.blindLevel}/{t.blindLevelCount}
                    {t.currentBlinds.ante > 0 && ` | Ante: ${t.currentBlinds.ante}`}
                  </div>
                )}
              </div>

              <div className="tournament-actions">
                {t.status === 'registering' && !isRegistered && (
                  <button
                    className="btn-tournament-register"
                    onClick={() => handleRegister(t.tournamentId)}
                    disabled={!playerName}
                  >
                    Register
                  </button>
                )}
                {t.status === 'registering' && isRegistered && (
                  <div className="tournament-registered-actions">
                    <button className="btn-tournament-registered" disabled>Registered</button>
                    <button
                      className="btn-tournament-withdraw"
                      onClick={() => handleWithdraw(t.tournamentId)}
                    >
                      Withdraw
                    </button>
                  </div>
                )}
                {t.status === 'running' && (
                  <span style={{ color: '#4ADE80', fontSize: '0.8rem', fontWeight: 600 }}>
                    {isPaused ? 'Paused' : 'In Progress'}
                  </span>
                )}
                {/* GAP 15 — admin-only live TD controls. Server re-checks the
                    privilege on every emit, so this is UX gating only. */}
                {isAdmin && t.status === 'running' && (
                  <div className="tournament-td-controls">
                    <button
                      className="btn-tournament-td"
                      onClick={() => handleTogglePause(t.tournamentId, !isPaused)}
                    >
                      {isPaused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                    <button
                      className="btn-tournament-td"
                      onClick={() => handleAdvanceLevel(t.tournamentId)}
                    >
                      ⏭ Advance Level
                    </button>
                    <button
                      className="btn-tournament-td"
                      onClick={() => handleRebalance(t.tournamentId)}
                    >
                      ⚖ Rebalance Now
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
