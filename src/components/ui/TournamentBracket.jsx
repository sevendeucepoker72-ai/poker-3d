import React, { useMemo, useState, useEffect, useRef } from 'react';
import './TournamentBracket.css';
// Sit & Go fix-all F7 — the payout table in the event detail (the lobby item's `payouts`).
import { useTournamentRegistrationStore } from '../../store/tournamentRegistrationStore';
import { payoutTableText, payoutsNote } from '../../utils/tournamentFinish';

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

export const BRACKET_NONE_TEXT = 'No tournament running';

/**
 * R2 (APPUI-42): the bracket of ONE tournament (the lobby asks the server for
 * the id of the card that opened it). `tournament` null after the server
 * answered = there is no such running tournament: says so instead of an empty
 * "Live" bracket; `loading` while the first answer is pending.
 */
export default function TournamentBracket({ tournament, loading = false, onClose }) {
  if (!tournament) {
    return (
      <div className="tb-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="tb-modal tb-modal--empty">
          <div className="tb-header">
            <div className="tb-header-left">
              <h2 className="tb-title">{loading ? 'Live Bracket' : BRACKET_NONE_TEXT}</h2>
            </div>
            <button className="tb-close-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="tb-content">
            <div className="tb-empty">
              {loading ? 'Loading the bracket…' : 'There is no tournament in progress right now. The bracket opens here while one is running.'}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return <TournamentBracketView tournament={tournament} onClose={onClose} />;
}

function TournamentBracketView({ tournament, onClose }) {
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
  // F7 — the payouts of this tournament: its lobby item (by id), else the bracket answer itself.
  const listItem = useTournamentRegistrationStore((s) => (tournament && tournament.tournamentId != null
    ? s.tournaments.find((t) => String(t.tournamentId) === String(tournament.tournamentId)) : null) || null);
  const payoutsText = payoutTableText(listItem) || payoutTableText(tournament);
  const payoutsNoteText = listItem ? payoutsNote(listItem) : payoutsNote(tournament);
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

        {payoutsText && (
          <div className="tournament-payouts tb-payouts" style={{ padding: '6px 16px', fontSize: '0.8rem', color: '#ffd24a' }}>
            Payouts: {payoutsText}{payoutsNoteText ? ` (${payoutsNoteText})` : ''}
          </div>
        )}

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
