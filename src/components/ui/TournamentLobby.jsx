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
  const playerName = useGameStore((s) => s.playerName);
  const setScreen = useGameStore((s) => s.setScreen);

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

    socket.on('tournamentList', handleList);
    socket.on('tournamentRegistered', handleRegistered);
    socket.on('tournamentStarted', handleStarted);

    const interval = setInterval(() => socket.emit('getTournaments'), 5000);

    return () => {
      socket.off('tournamentList', handleList);
      socket.off('tournamentRegistered', handleRegistered);
      socket.off('tournamentStarted', handleStarted);
      clearInterval(interval);
    };
  }, [setScreen]);

  const handleRegister = (tournamentId) => {
    const socket = getSocket();
    if (!socket || !playerName) return;
    socket.emit('registerTournament', { tournamentId, playerName });
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
                    <span className="tournament-detail-value">{t.prizePool.toLocaleString()}</span>
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
                  <button className="btn-tournament-registered">Registered</button>
                )}
                {t.status === 'running' && (
                  <span style={{ color: '#4ADE80', fontSize: '0.8rem', fontWeight: 600 }}>
                    In Progress
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
