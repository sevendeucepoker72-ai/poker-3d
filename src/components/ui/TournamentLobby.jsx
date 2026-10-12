import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTournamentRegistrationStore, tournamentCancelledText, pendingKind } from '../../store/tournamentRegistrationStore';
import { getSocket } from '../../services/socketService';
import { reportPlayRefusal, runPlayFlow, GAME_SERVER_UNREACHABLE_TEXT } from '../../services/playRefusal';
import './TournamentLobby.css';

// How long a Register / Withdraw tap waits for its answer (or an `error`)
// before telling the player the server never answered.
const REGISTER_WATCHDOG_MS = 10000;
// Stable server codes (R2 contract C2).
const ALREADY_REGISTERED_CODE = 'already_registered';
export const TOURNAMENT_ALREADY_REGISTERED_TEXT = "You're already registered for this tournament.";

const TOURNAMENT_ICONS = {
  'Freeroll': '🎯',
  'Daily 5K': '💰',
  'High Stakes': '💎',
};

const STATUS_LABELS = { registering: 'Registering', running: 'Live', finished: 'Finished', starting: 'Starting' };

/**
 * Tournament cards (Home + Play tabs). R2 (C2, 2026-10-11): registration
 * state lives in the shared store (store/tournamentRegistrationStore), hydrated
 * from the server list's `registered` flags — it survives tab switches,
 * remounts and reloads, so Register is never offered twice for one entry.
 */
export default function TournamentLobby({ onOpenBracket = null }) {
  const tournaments = useTournamentRegistrationStore((s) => s.tournaments);
  const registered = useTournamentRegistrationStore((s) => s.registered);
  const pending = useTournamentRegistrationStore((s) => s.pending);
  const cancellations = useTournamentRegistrationStore((s) => s.cancellations);
  const syncOwner = useTournamentRegistrationStore((s) => s.syncOwner);
  const setPending = useTournamentRegistrationStore((s) => s.setPending);
  const noteRegistered = useTournamentRegistrationStore((s) => s.noteRegistered);
  const dismissCancellation = useTournamentRegistrationStore((s) => s.dismissCancellation);
  // Live paused-state per running tournament, driven by the server's
  // `tournamentPaused` / `tournamentResumed` broadcasts (GAP 15). Only
  // meaningful for the admin TD controls below.
  const [pausedIds, setPausedIds] = useState(new Set());
  const playerName = useGameStore((s) => s.playerName);
  // Admin flag (set from the server's loginResult userData). Server enforces
  // the actual privilege on every TD control emit; this only gates the UI.
  const isAdmin = useGameStore((s) => s.isAdmin);
  // The tournament whose Register / Withdraw tap waits for an answer, and the
  // last line to show for it ({ kind: 'error' | 'info', text }). Refusals
  // (suspended / no account) go to the shared PlayRefusalNotice instead.
  const [inFlight, setInFlight] = useState(null); // { id, kind }
  const [regNotice, setRegNotice] = useState(null);

  useEffect(() => {
    syncOwner();
    const socket = getSocket();
    if (!socket) return undefined;
    socket.emit('getTournaments');
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
    socket.on('tournamentPaused', handlePaused);
    socket.on('tournamentResumed', handleResumed);
    const interval = setInterval(() => socket.emit('getTournaments'), 5000);
    return () => {
      socket.off('tournamentPaused', handlePaused);
      socket.off('tournamentResumed', handleResumed);
      clearInterval(interval);
    };
  }, [syncOwner]);

  // While a Register / Withdraw is in flight: its answer, a refusal on the
  // shared 'error' event, or the watchdog ends it.
  useEffect(() => {
    if (!inFlight) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const settle = () => { setInFlight(null); setPending(inFlight.id, null); };
    const onRegistered = (data) => {
      if (String(data?.tournamentId) !== String(inFlight.id)) return;
      settle();
      setRegNotice(null);
    };
    const onUnregistered = (data) => {
      if (String(data?.tournamentId) !== String(inFlight.id)) return;
      settle();
      const n = Number(data?.refunded);
      setRegNotice({ kind: 'info', text: Number.isFinite(n) && n > 0 ? `Withdrawn — your ${n.toLocaleString()}-chip entry was refunded.` : 'Withdrawn from the tournament.' });
    };
    const onServerError = (err) => {
      settle();
      if (reportPlayRefusal(err)) { setRegNotice(null); return; }
      if (err?.code === ALREADY_REGISTERED_CODE) {
        noteRegistered({ tournamentId: inFlight.id, entryId: err?.entryId });
        setRegNotice({ kind: 'info', text: TOURNAMENT_ALREADY_REGISTERED_TEXT });
        return;
      }
      setRegNotice({ kind: 'error', text: err?.message || (inFlight.kind === 'withdraw' ? 'Could not withdraw — please try again.' : 'Registration failed — please try again.') });
    };
    socket.on('tournamentRegistered', onRegistered);
    socket.on('tournamentUnregistered', onUnregistered);
    socket.on('error', onServerError);
    const watchdog = setTimeout(() => {
      settle();
      setRegNotice({ kind: 'error', text: GAME_SERVER_UNREACHABLE_TEXT });
    }, REGISTER_WATCHDOG_MS);
    return () => {
      socket.off('tournamentRegistered', onRegistered);
      socket.off('tournamentUnregistered', onUnregistered);
      socket.off('error', onServerError);
      clearTimeout(watchdog);
    };
  }, [inFlight, setPending, noteRegistered]);

  // 2026-10-07 — play-refusal replay (services/playRefusal.js): a
  // login_required on a still-signed-in tab re-authenticates the socket and
  // runs this registration again ONCE (spinner + watchdog included) through
  // the latest handleRegister, unless the lobby has unmounted.
  const handleRegisterRef = useRef(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const handleRegister = (tournamentId) => {
    const socket = getSocket();
    if (!socket || !playerName) return;
    if (useTournamentRegistrationStore.getState().isRegistered(tournamentId)) return; // never a second entry
    setRegNotice(null);
    setPending(tournamentId, 'register');
    setInFlight({ id: tournamentId, kind: 'register' });
    runPlayFlow(() => {
      if (mountedRef.current && handleRegisterRef.current) handleRegisterRef.current(tournamentId);
    }, () => socket.emit('registerTournament', { tournamentId, playerName }));
  };
  useEffect(() => { handleRegisterRef.current = handleRegister; });

  const handleWithdraw = (tournamentId) => {
    const socket = getSocket();
    if (!socket) return;
    setRegNotice(null);
    setPending(tournamentId, 'withdraw');
    setInFlight({ id: tournamentId, kind: 'withdraw' });
    socket.emit('leaveTournament', { tournamentId });
  };

  // ── GAP 15: live TD controls (admin-only; server enforces the privilege) ──
  const handleTogglePause = (tournamentId, paused) => {
    getSocket()?.emit('pauseTournament', { tournamentId, paused });
  };
  const handleAdvanceLevel = (tournamentId) => {
    getSocket()?.emit('advanceTournamentLevel', { tournamentId });
  };
  const handleRebalance = (tournamentId) => {
    getSocket()?.emit('rebalanceTournament', { tournamentId });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return null;
    const diff = timestamp - Date.now();
    if (diff <= 0) return diff > -120000 ? 'Starting soon…' : null;
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  if (tournaments.length === 0 && cancellations.length === 0) return null;

  return (
    <div className="tournament-section">
      <h2>Tournaments</h2>
      {cancellations.map((c) => (
        <div
          key={c.tournamentId}
          className="tournament-cancelled-notice"
          role="status"
          onClick={() => dismissCancellation(c.tournamentId)}
        >
          <span>{tournamentCancelledText(c)}</span>
          <span className="tournament-notice-dismiss">Dismiss</span>
        </div>
      ))}
      {regNotice && (
        <div
          className={`tournament-register-error ${regNotice.kind === 'info' ? 'tournament-register-info' : ''}`}
          role={regNotice.kind === 'error' ? 'alert' : 'status'}
          onClick={() => setRegNotice(null)}
        >
          {regNotice.text} <span className="tournament-notice-dismiss">(tap to dismiss)</span>
        </div>
      )}
      <div className="tournament-grid">
        {tournaments.map((t) => {
          const id = t.tournamentId;
          const isRegistered = !!registered[String(id)];
          const pend = pendingKind(pending, id);
          const icon = TOURNAMENT_ICONS[t.name] || '🏆';
          // Prefer the server's authoritative paused flag from the polled list
          // (an admin in the LOBBY isn't in the tournament's table room, so the
          // tournamentPaused echo alone never reaches them); the echo just gives
          // instant feedback between 5s polls.
          const isPaused = !!t.paused || pausedIds.has(id);
          const startsIn = t.status === 'registering' ? formatTime(t.nextStartTime) : null;
          const buyIn = Number(t.buyIn) || 0;

          return (
            <div key={id} className={`tournament-card ${t.status}${isRegistered ? ' tournament-card--mine' : ''}`}>
              <div className="tournament-icon">{icon}</div>

              <div className="tournament-info">
                <div className="tournament-name">
                  {t.name}
                  <span className={`tournament-status-badge ${t.status}`} style={{ marginLeft: '8px' }}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                  {isRegistered && <span className="tournament-entered-badge">Entered</span>}
                </div>

                <div className="tournament-details">
                  <div className="tournament-detail">
                    <span className="tournament-detail-label">Buy-in:</span>
                    <span className="tournament-detail-value">{buyIn === 0 ? 'Free' : buyIn.toLocaleString()}</span>
                  </div>
                  <div className="tournament-detail">
                    <span className="tournament-detail-label">Prize:</span>
                    {/* The REAL payable pool: freerolls are house-funded to the
                        advertised amount; buy-in events show the live funded pool. */}
                    <span className="tournament-detail-value">
                      {Number(t.fundedPool ?? t.prizePool ?? 0).toLocaleString()}
                      {t.isFreeroll ? ' (freeroll)' : ''}
                    </span>
                  </div>
                  <div className="tournament-detail">
                    <span className="tournament-detail-label">Players:</span>
                    <span className="tournament-detail-value">{t.registeredPlayers}/{t.maxPlayers}</span>
                  </div>
                  {t.currentBlinds && (
                    <div className="tournament-detail">
                      <span className="tournament-detail-label">Blinds:</span>
                      <span className="tournament-detail-value">{t.currentBlinds.sb}/{t.currentBlinds.bb}</span>
                    </div>
                  )}
                </div>

                {startsIn && <div className="tournament-timer">Starts in: {startsIn}</div>}

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
                    onClick={() => handleRegister(id)}
                    disabled={!playerName || !!pend}
                  >
                    {pend === 'register' ? 'Registering…' : (buyIn > 0 ? `Register · ${buyIn.toLocaleString()}` : 'Register')}
                  </button>
                )}
                {t.status === 'registering' && isRegistered && (
                  <div className="tournament-registered-actions">
                    <button className="btn-tournament-registered" disabled>✓ Registered</button>
                    <button
                      className="btn-tournament-withdraw"
                      onClick={() => handleWithdraw(id)}
                      disabled={!!pend}
                    >
                      {pend === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  </div>
                )}
                {t.status === 'running' && (
                  <span className="tournament-live-label">{isPaused ? 'Paused' : 'In Progress'}</span>
                )}
                {t.status === 'running' && typeof onOpenBracket === 'function' && (
                  <button className="btn-tournament-bracket" onClick={() => onOpenBracket(id, t.name)}>
                    🏆 Live Bracket
                  </button>
                )}
                {/* GAP 15 — admin-only live TD controls. Server re-checks the
                    privilege on every emit, so this is UX gating only. */}
                {isAdmin && t.status === 'running' && (
                  <div className="tournament-td-controls">
                    <button className="btn-tournament-td" onClick={() => handleTogglePause(id, !isPaused)}>
                      {isPaused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                    <button className="btn-tournament-td" onClick={() => handleAdvanceLevel(id)}>
                      ⏭ Advance Level
                    </button>
                    <button className="btn-tournament-td" onClick={() => handleRebalance(id)}>
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
