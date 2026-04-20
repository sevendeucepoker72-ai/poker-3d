import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useQualifiers } from '../../store/qualifierStore';
import { getSocket } from '../../services/socketService';
import { useTableStore } from '../../store/tableStore';
import QualifierDashboard from './QualifierDashboard';

function formatCountdown(isoDate) {
  const diff = new Date(isoDate) - Date.now();
  if (diff <= 0) return 'Starting soon';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function QualifierLobby({ onSpectate }) {
  const playerName = useGameStore((s) => s.playerName);
  const gameState = useTableStore((s) => s.gameState);
  const phone = gameState?.yourPhone || sessionStorage.getItem('poker_remember_phone') || '';
  const allQualifiers = useQualifiers();
  const qualifiers = allQualifiers.filter((q) => q.active).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  const [qualStatus, setQualStatus] = useState({ weekly: false, monthly: false });
  const [loading, setLoading] = useState(true);
  const [tournamentData, setTournamentData] = useState({}); // qualifierId -> {registeredCount, players, status, tournamentId}
  const [myRegistrations, setMyRegistrations] = useState(new Set());
  const [openDashboard, setOpenDashboard] = useState(null); // qualifier id or null

  // Fetch qualification status + tournament registrations
  useEffect(() => {
    const socket = getSocket();
    if (!socket) { setLoading(false); return; }

    // Always emit, even if phone is empty — server returns {weekly:false,
    // monthly:false} which correctly resolves the loading state. Previously
    // skipping the emit when phone was blank left the UI stuck on
    // "Checking qualification..." indefinitely for users whose phone wasn't
    // populated in the store (e.g., OAuth-signed-in users before the
    // oauthLogin handler started including phone in userData).
    socket.emit('getQualifications', { phone: phone || '' });
    socket.emit('getQualifierTournaments');

    // Safety net: bail out of loading after 8s even if no response arrives.
    const loadingTimeout = setTimeout(() => setLoading(false), 8000);

    const qualHandler = (data) => {
      setQualStatus(data);
      setLoading(false);
      clearTimeout(loadingTimeout);
    };
    const tournListHandler = (list) => {
      const map = {};
      for (const t of list) {
        map[t.qualifierId] = t;
        // Check if I'm registered
        if (t.players?.some(p => p.name === playerName)) {
          setMyRegistrations(prev => new Set([...prev, t.qualifierId]));
        }
      }
      setTournamentData(map);
    };
    const tournUpdateHandler = (data) => {
      setTournamentData(prev => ({
        ...prev,
        [data.qualifierId]: { ...prev[data.qualifierId], ...data },
      }));
    };
    const regResultHandler = (data) => {
      if (data.success) {
        if (data.unregistered) {
          setMyRegistrations(prev => { const s = new Set(prev); s.delete(data.qualifierId); return s; });
        } else {
          setMyRegistrations(prev => new Set([...prev, data.qualifierId]));
        }
      }
    };
    const tournStartHandler = (data) => {
      setTournamentData(prev => ({
        ...prev,
        [data.qualifierId]: { ...prev[data.qualifierId], status: 'running', tournamentId: data.tournamentId },
      }));
    };

    socket.on('qualifications', qualHandler);
    socket.on('qualifierTournamentList', tournListHandler);
    socket.on('qualifierTournamentUpdate', tournUpdateHandler);
    socket.on('qualifierRegistrationResult', regResultHandler);
    socket.on('qualifierTournamentStarted', tournStartHandler);

    // Adaptive polling with exponential backoff. On every successful response
    // the backoff resets to the base interval (10s). If we go a full poll cycle
    // without seeing a fresh list (disconnected / server unhealthy), the delay
    // doubles up to a 2-minute ceiling. That keeps steady-state traffic light
    // while avoiding a DDoS-style flood against an unhealthy server.
    const BASE_MS = 10000;
    const MAX_MS = 120000;
    let currentDelay = BASE_MS;
    let lastListAt = Date.now();
    let pollTimer = null;

    const resetBackoffOnList = (origHandler) => (list) => {
      currentDelay = BASE_MS;
      lastListAt = Date.now();
      origHandler(list);
    };
    // Hot-swap the list handler so we can observe success without rewriting it
    socket.off('qualifierTournamentList', tournListHandler);
    const wrappedListHandler = resetBackoffOnList(tournListHandler);
    socket.on('qualifierTournamentList', wrappedListHandler);

    const scheduleNextPoll = () => {
      pollTimer = setTimeout(() => {
        // If we haven't heard back in 2× the current delay, double it (capped).
        if (Date.now() - lastListAt > currentDelay * 2) {
          currentDelay = Math.min(MAX_MS, currentDelay * 2);
        }
        socket.emit('getQualifierTournaments');
        scheduleNextPoll();
      }, currentDelay);
    };
    scheduleNextPoll();

    return () => {
      socket.off('qualifications', qualHandler);
      socket.off('qualifierTournamentList', wrappedListHandler);
      socket.off('qualifierTournamentUpdate', tournUpdateHandler);
      socket.off('qualifierRegistrationResult', regResultHandler);
      socket.off('qualifierTournamentStarted', tournStartHandler);
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(loadingTimeout);
    };
  }, [phone, playerName]);

  const handleRegister = useCallback((qualifier) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('registerQualifierTournament', {
      qualifierId: qualifier.id,
      playerName,
      phone,
    });
  }, [playerName, phone]);

  const handleUnregister = useCallback((qualifier) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('unregisterQualifierTournament', { qualifierId: qualifier.id });
  }, []);

  const handleSpectate = useCallback((tournamentId) => {
    const socket = getSocket();
    if (!socket || !tournamentId) return;
    socket.emit('spectateTournament', { tournamentId });
    if (onSpectate) onSpectate();
  }, [onSpectate]);

  if (qualifiers.length === 0) {
    // While the qualification check is still in flight, show a skeleton rather
    // than the "No active qualifiers" copy — the store hydrates synchronously
    // but the server might still be producing the list, so we don't want the
    // first frame to flash the empty message only for qualifiers to appear.
    if (loading) {
      return (
        <div style={{ color: '#666', fontSize: '0.85rem', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: '#00D9FF33', border: '1px solid #00D9FF',
            animation: 'pulse 1.2s infinite',
          }} />
          Checking available qualifiers…
        </div>
      );
    }
    return <div style={{ color: '#555', fontSize: '0.85rem', padding: '12px 0' }}>No active qualifiers at this time.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {qualifiers.map((q) => {
        const color = q.color || '#00D9FF';
        const tier = q.type?.toLowerCase();
        const qualStat = qualStatus[tier];
        const isQualified = qualStat && qualStat.qualified;
        const isRegistered = myRegistrations.has(q.id);
        const tData = tournamentData[q.id];
        const regCount = tData?.registeredCount || q.registered || 0;
        const tournStatus = tData?.status || 'registering';
        const tournamentId = tData?.tournamentId;
        const isRunning = tournStatus === 'running';
        const isFinished = tournStatus === 'finished';
        const registeredPlayers = tData?.players || [];
        const signupOpen = tData?.signupOpen ?? true;
        const signupOpensAt = tData?.signupOpensAt;
        const signupClosesAt = tData?.signupClosesAt;

        return (
          <div key={q.id} onClick={() => setOpenDashboard(q.id)} style={{
            background: 'linear-gradient(135deg, rgba(10,10,20,0.95), rgba(30,20,60,0.7))',
            border: `1px solid ${isRunning ? '#4ADE8055' : color + '33'}`,
            borderRadius: 14,
            padding: '18px 20px',
            cursor: 'pointer',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: '1.8rem' }}>{q.icon || '🏆'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>{q.name}</span>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px',
                    borderRadius: 20, background: `${color}22`, color,
                    border: `1px solid ${color}55`, textTransform: 'uppercase',
                  }}>{q.type}</span>
                  {isRunning && (
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px',
                      borderRadius: 20, background: 'rgba(74,222,128,0.15)', color: '#4ADE80',
                      border: '1px solid rgba(74,222,128,0.4)', textTransform: 'uppercase',
                      animation: 'pulse 2s infinite',
                    }}>LIVE</span>
                  )}
                </div>
                <div style={{ color: '#aaa', fontSize: '0.78rem', marginTop: 2 }}>
                  {new Date(q.scheduledAt).toUTCString().replace(' GMT', ' UTC')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {!isRunning && !isFinished && (
                  <>
                    <div style={{ color, fontWeight: 700, fontSize: '0.85rem' }}>{formatCountdown(q.scheduledAt)}</div>
                    <div style={{ color: '#666', fontSize: '0.7rem' }}>until start</div>
                  </>
                )}
                {isRunning && (
                  <div style={{ color: '#4ADE80', fontWeight: 700, fontSize: '0.85rem' }}>In Progress</div>
                )}
                {isFinished && (
                  <div style={{ color: '#888', fontWeight: 700, fontSize: '0.85rem' }}>Finished</div>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: '0.78rem', color: '#aaa', flexWrap: 'wrap' }}>
              <span>🎰 Stack: <strong style={{ color: '#fff' }}>{(q.startingStack || 0).toLocaleString()}</strong></span>
              <span>👥 <strong style={{ color: '#fff' }}>{regCount}/{q.maxPlayers}</strong> registered</span>
              {isQualified && !isRunning && (
                <span style={{ color: '#4ADE80' }}>✓ {qualStat.credits} credit{qualStat.credits > 1 ? 's' : ''}</span>
              )}
              {!isRunning && !isFinished && signupOpen && signupClosesAt && (
                <span style={{ color: '#FFB74D' }}>⏱ Signup closes in {formatCountdown(signupClosesAt)}</span>
              )}
            </div>

            {/* Registered players list */}
            {regCount > 0 && !isRunning && (
              <div style={{
                marginBottom: 12, padding: '8px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                maxHeight: 80, overflowY: 'auto', fontSize: '0.75rem', color: '#888',
              }}>
                {registeredPlayers.map((p, i) => (
                  <span key={i}>
                    {p.name}{i < registeredPlayers.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </div>
            )}

            {/* Action area */}
            {loading ? (
              <div style={{ color: '#666', fontSize: '0.8rem', padding: '10px 0' }}>Checking qualification...</div>
            ) : isRunning ? (
              <button onClick={() => handleSpectate(tournamentId)} style={{
                width: '100%', padding: '12px 18px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem',
                background: 'linear-gradient(135deg, #4ADE80, #22c55e)',
                color: '#0a0a1a', border: 'none', cursor: 'pointer',
              }}>
                Watch Live
              </button>
            ) : isFinished ? (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(136,136,170,0.08)', border: '1px solid rgba(136,136,170,0.2)',
                color: '#888', fontSize: '0.82rem', textAlign: 'center',
              }}>
                Tournament completed
              </div>
            ) : isRegistered ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                  color: '#4ADE80', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center',
                }}>
                  ✓ Registered
                </div>
                <button onClick={() => handleUnregister(q)} style={{
                  padding: '10px 14px', borderRadius: 8, fontSize: '0.8rem',
                  background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                  color: '#F87171', cursor: 'pointer',
                }}>
                  Withdraw
                </button>
              </div>
            ) : !signupOpen && signupOpensAt && new Date(signupOpensAt) > new Date() ? (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(255,183,77,0.08)', border: '1px solid rgba(255,183,77,0.25)',
                color: '#FFB74D', fontSize: '0.82rem', textAlign: 'center',
              }}>
                Signup opens {formatCountdown(signupOpensAt)} before game — {new Date(signupOpensAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            ) : !signupOpen && signupClosesAt ? (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(136,136,170,0.08)', border: '1px solid rgba(136,136,170,0.2)',
                color: '#888', fontSize: '0.82rem', textAlign: 'center',
              }}>
                Signup window has closed
              </div>
            ) : isQualified ? (
              <button onClick={() => handleRegister(q)} style={{
                width: '100%', padding: '12px 18px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem',
                background: `linear-gradient(135deg, ${color}, ${color}bb)`,
                color: '#0a0a1a', border: 'none', cursor: 'pointer',
              }}>
                Register — You're Qualified!
              </button>
            ) : (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                color: '#F87171', fontSize: '0.82rem', textAlign: 'center',
              }}>
                Not yet qualified — finish top 5 at a live game to earn entry
              </div>
            )}
          </div>
        );
      })}

      {/* Dashboard modal */}
      {openDashboard && (() => {
        const q = qualifiers.find(x => x.id === openDashboard);
        if (!q) return null;
        const tier = q.type?.toLowerCase();
        const qualStat = qualStatus[tier];
        return (
          <QualifierDashboard
            qualifier={q}
            tournamentData={tournamentData[q.id]}
            isRegistered={myRegistrations.has(q.id)}
            isQualified={qualStat && qualStat.qualified}
            onRegister={() => { handleRegister(q); setOpenDashboard(null); }}
            onUnregister={() => { handleUnregister(q); setOpenDashboard(null); }}
            onSpectate={(tid) => { handleSpectate(tid); setOpenDashboard(null); }}
            onClose={() => setOpenDashboard(null)}
          />
        );
      })()}
    </div>
  );
}
