import { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../../services/socketService';
import { useTableStore } from '../../store/tableStore';
import { DEFAULT_BLIND_STRUCTURE } from '../../store/qualifierStore';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatCountdown(isoDate) {
  const diff = new Date(isoDate) - Date.now();
  if (diff <= 0) return 'Starting soon';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export default function QualifierDashboard({ qualifier, tournamentData, isRegistered, isQualified, onRegister, onUnregister, onSpectate, onClose }) {
  const [countdown, setCountdown] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // Hardware back button closes the dashboard
  useBackButtonClose(true, onClose);

  const color = qualifier.color || '#00D9FF';
  const blinds = qualifier.blindStructure || DEFAULT_BLIND_STRUCTURE;
  const tData = tournamentData || {};
  const status = tData.status || 'registering';
  const isRunning = status === 'running';
  const isFinished = status === 'finished';
  const regCount = tData.registeredCount || 0;
  const players = tData.players || [];
  const tournStatus = tData.tournamentStatus || null;

  // Live countdown — stops ticking once start time has passed (was spinning
  // forever at "Starting soon" after kickoff).
  useEffect(() => {
    // Declare `id` FIRST so the initial synchronous tick below can still
    // safely reference it. Previously `id` was declared after `tick()` ran
    // once, meaning the first tick's `clearInterval(id)` passed `undefined`
    // if the start time was already past.
    let id;
    const tick = () => {
      setCountdown(formatCountdown(qualifier.scheduledAt));
      if (new Date(qualifier.scheduledAt) - Date.now() <= 0) {
        if (id !== undefined) clearInterval(id);
      }
    };
    tick();
    id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qualifier.scheduledAt]);

  // #7 — register/unregister needs a loading state so double-clicks don't
  // emit duplicate events. We flip the flag on click and clear it when the
  // parent re-renders with a new `isRegistered` value (i.e., server ack).
  const [pending, setPending] = useState(null); // 'register' | 'unregister' | null
  useEffect(() => { setPending(null); }, [isRegistered]);
  const handleRegisterClick = () => {
    if (pending) return;
    setPending('register');
    onRegister && onRegister();
    // Fail-safe: if the server ack never arrives, free the UI in 8s
    setTimeout(() => setPending((p) => p === 'register' ? null : p), 8000);
  };
  const handleUnregisterClick = () => {
    if (pending) return;
    setPending('unregister');
    onUnregister && onUnregister();
    setTimeout(() => setPending((p) => p === 'unregister' ? null : p), 8000);
  };

  // Prize structure
  const prizePool = regCount * 0; // free qualifier — prizes are qualifier seats
  const prizes = [
    { place: '1st', prize: 'Championship Seat' },
    { place: '2nd', prize: 'Championship Seat' },
    { place: '3rd', prize: 'Championship Seat' },
    { place: '4th-5th', prize: 'Next Qualifier Entry' },
  ];

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'players', label: `Players (${regCount})` },
    { key: 'blinds', label: 'Blind Schedule' },
    { key: 'prizes', label: 'Prizes' },
  ];
  if (isRunning) tabs.push({ key: 'tables', label: `Tables (${tournStatus?.tables || '?'})` });

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
      padding: '20px', overflowY: 'auto',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 700, background: '#0d1929',
        borderRadius: 16, border: `1px solid ${color}33`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '24px 28px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <span style={{ fontSize: '2.5rem' }}>{qualifier.icon || '🏆'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, color: '#fff', fontSize: '1.3rem' }}>{qualifier.name}</h2>
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '3px 10px',
                borderRadius: 20, background: `${color}22`, color,
                border: `1px solid ${color}55`, textTransform: 'uppercase',
              }}>{qualifier.type}</span>
              {isRunning && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '3px 10px',
                  borderRadius: 20, background: 'rgba(74,222,128,0.15)', color: '#4ADE80',
                  border: '1px solid rgba(74,222,128,0.4)',
                  animation: 'pulse 2s infinite',
                }}>LIVE</span>
              )}
            </div>
            <div style={{ color: '#888', fontSize: '0.85rem', marginTop: 4 }}>
              {new Date(qualifier.scheduledAt).toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {!isRunning && !isFinished && (
              <div style={{ color, fontWeight: 800, fontSize: '1.2rem' }}>{countdown}</div>
            )}
            {isRunning && tournStatus && (
              <div style={{ color: '#4ADE80', fontWeight: 700, fontSize: '0.9rem' }}>
                {tournStatus.alivePlayers}/{tournStatus.totalPlayers} remaining
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#666',
            fontSize: '1.5rem', cursor: 'pointer', padding: '0 4px',
          }}>x</button>
        </div>

        {/* Stats bar */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
          background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          {[
            { label: 'Players', value: `${regCount}/${qualifier.maxPlayers}` },
            { label: 'Starting Stack', value: (qualifier.startingStack || 50000).toLocaleString() },
            { label: 'Blinds Start', value: `${blinds[0]?.sb}/${blinds[0]?.bb}` },
            { label: 'Levels', value: `${blinds.length} (${blinds[0]?.duration}min)` },
          ].map((stat, i) => (
            <div key={i} style={{ padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '1rem' }}>{stat.value}</div>
              <div style={{ color: '#666', fontSize: '0.7rem', textTransform: 'uppercase' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)',
          overflowX: 'auto',
        }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '10px 18px', background: 'transparent', border: 'none',
              color: activeTab === t.key ? color : '#888', cursor: 'pointer',
              fontWeight: activeTab === t.key ? 700 : 400, fontSize: '0.85rem',
              borderBottom: activeTab === t.key ? `2px solid ${color}` : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: '20px 28px', minHeight: 200 }}>

          {/* Overview */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {qualifier.type === 'Weekly' ? (
                  <p>Top 5 finishers at any live American Pub Poker game earn a qualification credit for this weekly online qualifier. Win this qualifier to earn your seat at the Championship at Bally's Blackhawk.</p>
                ) : (
                  <p>Monthly Major Qualifier — earn your entry through weekly play. Top finishers win a direct seat to the Championship.</p>
                )}
              </div>

              {isRunning && tournStatus && (
                <div style={{
                  padding: 16, borderRadius: 10,
                  background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)',
                }}>
                  <div style={{ color: '#4ADE80', fontWeight: 700, marginBottom: 8 }}>Tournament In Progress</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: '0.85rem' }}>
                    <div><span style={{ color: '#888' }}>Players:</span> <strong style={{ color: '#fff' }}>{tournStatus.alivePlayers}/{tournStatus.totalPlayers}</strong></div>
                    <div><span style={{ color: '#888' }}>Tables:</span> <strong style={{ color: '#fff' }}>{tournStatus.tables}</strong></div>
                    <div><span style={{ color: '#888' }}>Blinds:</span> <strong style={{ color: '#fff' }}>{tournStatus.blinds?.sb}/{tournStatus.blinds?.bb}</strong> (Lvl {tournStatus.blindLevel})</div>
                  </div>
                </div>
              )}

              <div style={{ color: '#888', fontSize: '0.8rem' }}>
                <strong style={{ color: '#aaa' }}>Rules:</strong> Late registration open for 2 hours after start. Re-entry allowed with additional qualifier credit. 20-hand sit-out limit.
              </div>
            </div>
          )}

          {/* Players */}
          {activeTab === 'players' && (
            <div>
              {players.length === 0 ? (
                <div style={{ color: '#666', textAlign: 'center', padding: 40 }}>No players registered yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {players.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 12px', borderRadius: 6,
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                    }}>
                      <span style={{ color: '#666', fontSize: '0.75rem', width: 24 }}>#{i + 1}</span>
                      <span style={{ color: '#fff', fontSize: '0.85rem', flex: 1 }}>{p.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Blind Schedule */}
          {activeTab === 'blinds' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#888' }}>Level</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>Small</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>Big</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>Ante</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {blinds.map((b, i) => {
                    const isCurrent = isRunning && tournStatus && tournStatus.blindLevel === i + 1;
                    return (
                      <tr key={i} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isCurrent ? 'rgba(74,222,128,0.1)' : 'transparent',
                      }}>
                        <td style={{ padding: '8px 12px', color: isCurrent ? '#4ADE80' : '#fff', fontWeight: isCurrent ? 700 : 400 }}>
                          {isCurrent && '> '}{i + 1}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#fff' }}>{b.sb.toLocaleString()}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#fff' }}>{b.bb.toLocaleString()}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: b.ante ? '#fff' : '#444' }}>{b.ante || '-'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>{b.duration}min</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Prizes */}
          {activeTab === 'prizes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {prizes.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', borderRadius: 8,
                  background: i === 0 ? 'rgba(252,211,77,0.08)' : 'rgba(255,255,255,0.02)',
                  border: i === 0 ? '1px solid rgba(252,211,77,0.2)' : '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span style={{ color: i === 0 ? '#fcd34d' : '#fff', fontWeight: 700 }}>{p.place}</span>
                  <span style={{ color: i === 0 ? '#fcd34d' : '#aaa' }}>{p.prize}</span>
                </div>
              ))}
              <div style={{ color: '#666', fontSize: '0.75rem', marginTop: 8, textAlign: 'center' }}>
                Prize structure subject to change based on player count
              </div>
            </div>
          )}

          {/* Tables (live only) */}
          {activeTab === 'tables' && isRunning && tournStatus && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: 8 }}>
                {tournStatus.tables} tables active | {tournStatus.alivePlayers} players remaining
              </div>
              <button onClick={() => onSpectate && onSpectate(tData.tournamentId)} style={{
                width: '100%', padding: '14px', borderRadius: 8, fontWeight: 700,
                background: 'linear-gradient(135deg, #4ADE80, #22c55e)',
                color: '#0a0a1a', border: 'none', cursor: 'pointer', fontSize: '1rem',
              }}>
                Watch Live
              </button>
            </div>
          )}
        </div>

        {/* Footer action */}
        <div style={{
          padding: '16px 28px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {isRunning ? (
            <button onClick={() => onSpectate && onSpectate(tData.tournamentId)} style={{
              width: '100%', padding: '14px', borderRadius: 10, fontWeight: 700, fontSize: '1rem',
              background: 'linear-gradient(135deg, #4ADE80, #22c55e)',
              color: '#0a0a1a', border: 'none', cursor: 'pointer',
            }}>
              Watch Live
            </button>
          ) : isFinished ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 8 }}>Tournament completed</div>
          ) : isRegistered ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                flex: 1, padding: '14px', borderRadius: 10, textAlign: 'center',
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                color: '#4ADE80', fontWeight: 700, fontSize: '0.95rem',
              }}>
                Registered
              </div>
              <button
                onClick={handleUnregisterClick}
                disabled={!!pending}
                style={{
                  padding: '14px 20px', borderRadius: 10,
                  background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                  color: '#F87171', cursor: pending ? 'default' : 'pointer', fontWeight: 600,
                  opacity: pending ? 0.6 : 1,
                }}
              >
                {pending === 'unregister' ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </div>
          ) : isQualified ? (
            <button
              onClick={handleRegisterClick}
              disabled={!!pending}
              style={{
                width: '100%', padding: '14px', borderRadius: 10, fontWeight: 700, fontSize: '1rem',
                background: `linear-gradient(135deg, ${color}, ${color}bb)`,
                color: '#0a0a1a', border: 'none', cursor: pending ? 'default' : 'pointer',
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending === 'register' ? 'Registering…' : "Register — You're Qualified!"}
            </button>
          ) : (
            <div style={{
              padding: '14px', borderRadius: 10, textAlign: 'center',
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
              color: '#F87171', fontSize: '0.9rem',
            }}>
              Not yet qualified — finish top 5 at a live game
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
