import React, { useMemo, useState, useEffect, useRef } from 'react';
import './TournamentBracket.css';

function formatChips(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function PlayerCard({ player, isChipLeader, isFinalTable, justEliminated }) {
  const isEliminated = player.finishPosition != null;
  const initial = (player.playerName || '?').charAt(0).toUpperCase();

  return (
    <div
      className={[
        'tb-card',
        isEliminated ? 'tb-card--eliminated' : 'tb-card--active',
        isChipLeader && !isEliminated ? 'tb-card--leader' : '',
        isFinalTable && !isEliminated ? 'tb-card--final-table' : '',
        justEliminated ? 'tb-card--just-eliminated' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="tb-card-inner">
        <div className="tb-card-avatar">
          {isEliminated ? '💀' : initial}
        </div>
        <div className="tb-card-info">
          <div className={`tb-card-name${isEliminated ? ' tb-card-name--out' : ''}`}>
            {player.playerName}
          </div>
          {!isEliminated ? (
            <div className="tb-card-chips">
              <span className="tb-chip-icon">🪙</span>
              <span className="tb-chip-count">{formatChips(player.chipCount)}</span>
            </div>
          ) : (
            <div className="tb-card-finish">{ordinal(player.finishPosition)} place</div>
          )}
        </div>
        {isChipLeader && !isEliminated && (
          <div className="tb-leader-crown" title="Chip Leader">👑</div>
        )}
      </div>

      {/* Chip bar (active players only) */}
      {!isEliminated && (
        <div className="tb-chip-bar-track" title={`${player.chipCount?.toLocaleString()} chips`}>
          <div
            className="tb-chip-bar-fill"
            style={{ width: `${player._pct ?? 0}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function TournamentBracket({ tournament, onClose }) {
  const {
    name = 'Tournament',
    players = [],
    eliminationOrder = [],
    status = 'running',
  } = tournament || {};

  // Track recently eliminated players for fade animation
  const [recentlyEliminated, setRecentlyEliminated] = useState(new Set());
  const prevEliminationOrderRef = useRef(eliminationOrder);

  useEffect(() => {
    const prev = prevEliminationOrderRef.current;
    const newlyElim = eliminationOrder.filter(id => !prev.includes(id));
    if (newlyElim.length > 0) {
      setRecentlyEliminated(s => {
        const next = new Set(s);
        newlyElim.forEach(id => next.add(id));
        return next;
      });
      const timer = setTimeout(() => {
        setRecentlyEliminated(s => {
          const next = new Set(s);
          newlyElim.forEach(id => next.delete(id));
          return next;
        });
      }, 800);
      prevEliminationOrderRef.current = eliminationOrder;
      return () => clearTimeout(timer);
    }
    prevEliminationOrderRef.current = eliminationOrder;
  }, [eliminationOrder]);

  const { activePlayers, eliminatedPlayers, chipLeaderId, maxChips } = useMemo(() => {
    const active = players.filter(p => p.finishPosition == null);
    const eliminated = players
      .filter(p => p.finishPosition != null)
      .sort((a, b) => a.finishPosition - b.finishPosition); // lower finish = later out = show first

    const maxChips = active.reduce((m, p) => Math.max(m, p.chipCount || 0), 0);
    const leader = active.reduce((best, p) => (!best || (p.chipCount || 0) > (best.chipCount || 0) ? p : best), null);

    // Attach percentage for bar widths
    active.forEach(p => {
      p._pct = maxChips > 0 ? Math.round(((p.chipCount || 0) / maxChips) * 100) : 0;
    });

    return {
      activePlayers: active,
      eliminatedPlayers: eliminated,
      chipLeaderId: leader?.playerId ?? null,
      maxChips,
    };
  }, [players]);

  const totalPlayers = players.length;
  const remainingPlayers = activePlayers.length;
  const isFinalTable = remainingPlayers > 0 && remainingPlayers <= 9;

  const statusLabel = {
    running: 'Live',
    finished: 'Finished',
    registering: 'Registering',
    paused: 'Paused',
  }[status] || status;

  const statusClass = {
    running: 'tb-status--live',
    finished: 'tb-status--done',
    registering: 'tb-status--reg',
    paused: 'tb-status--paused',
  }[status] || '';

  return (
    <div className="tb-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tb-modal">
        {/* Header */}
        <div className="tb-header">
          <div className="tb-header-left">
            <h2 className="tb-title">{name}</h2>
            <div className="tb-header-meta">
              <span className={`tb-status-badge ${statusClass}`}>{statusLabel}</span>
              {isFinalTable && status === 'running' && (
                <span className="tb-final-table-badge">Final Table</span>
              )}
              <span className="tb-player-count">
                {remainingPlayers} / {totalPlayers} remaining
              </span>
            </div>
          </div>
          <button className="tb-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Summary bar */}
        <div className="tb-summary">
          <div className="tb-summary-item">
            <span className="tb-summary-label">Total Entrants</span>
            <span className="tb-summary-value">{totalPlayers}</span>
          </div>
          <div className="tb-summary-item">
            <span className="tb-summary-label">Remaining</span>
            <span className="tb-summary-value tb-summary-value--live">{remainingPlayers}</span>
          </div>
          <div className="tb-summary-item">
            <span className="tb-summary-label">Eliminated</span>
            <span className="tb-summary-value">{eliminatedPlayers.length}</span>
          </div>
          {chipLeaderId && (
            <div className="tb-summary-item">
              <span className="tb-summary-label">Chip Leader</span>
              <span className="tb-summary-value tb-summary-value--leader">
                {activePlayers.find(p => p.playerId === chipLeaderId)?.playerName ?? '—'}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="tb-content">
          {/* Active players */}
          {activePlayers.length > 0 && (
            <section className="tb-section">
              <h3 className="tb-section-title">
                Active Players
                {isFinalTable && <span className="tb-section-badge">Final Table</span>}
              </h3>
              <div className="tb-grid">
                {activePlayers.map(player => (
                  <PlayerCard
                    key={player.playerId}
                    player={player}
                    isChipLeader={player.playerId === chipLeaderId}
                    isFinalTable={isFinalTable}
                    justEliminated={false}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Eliminated players */}
          {eliminatedPlayers.length > 0 && (
            <section className="tb-section">
              <h3 className="tb-section-title tb-section-title--elim">
                Eliminated
              </h3>
              <div className="tb-grid">
                {eliminatedPlayers.map(player => (
                  <PlayerCard
                    key={player.playerId}
                    player={player}
                    isChipLeader={false}
                    isFinalTable={false}
                    justEliminated={recentlyEliminated.has(player.playerId)}
                  />
                ))}
              </div>
            </section>
          )}

          {players.length === 0 && (
            <div className="tb-empty">No players registered yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
