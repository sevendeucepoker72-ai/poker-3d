import { useState, useEffect, useRef } from 'react';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import { notify } from '../../hooks/usePushNotifications';
import { qualifierSignupState, qualifierResultText, seatsForTopText, ordinal, formatDenverWhen } from '../../utils/qualifierList';

function formatCountdown(target, now) {
  if (target == null) return '';
  const diff = target - now;
  if (diff <= 0) return '';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// Review fix-up 2026-10-22 — on the Denver clock with its zone ("Sun, Oct 25 ·
// 2:00 PM MT"), as the home card and the lobby say it (it was the browser's
// zone with no label).
function formatWhen(t) {
  return formatDenverWhen(t);
}

/**
 * Qualifier detail (R2 C3, 2026-10-11 — APPUI-44 / TOURNEY-13). Everything it
 * shows comes from the server's list item (utils/qualifierList): the real
 * start time and signup / late-registration window, the structure (starting
 * stack + levels) and the seat count only when the server sent them, the
 * registered count, and the player's own place + "won a championship seat".
 * No built-in default blind schedule or prize table, no "2 hours late reg"
 * copy the server never promised. `action` is the card's own action area
 * (Register / Withdraw / Watch Live), so both places behave the same.
 */
export default function QualifierDashboard({ qualifier, now: nowProp, isRegistered, isQualified, action, onClose }) {
  const q = qualifier;
  const [now, setNow] = useState(() => nowProp || Date.now());
  const [activeTab, setActiveTab] = useState('overview');

  // Hardware back button closes the dashboard
  useBackButtonClose(true, onClose);

  // Live countdown — ticks only while something is ahead of us.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = qualifierSignupState(q, now);
  const isRunning = state === 'running' || state === 'late';
  const isFinished = state === 'finished';
  const color = q.type === 'monthly' ? '#9db8ff' : '#ffd24a';
  const levels = q.structure?.levels || [];
  const seatsLine = seatsForTopText(q.seatsForTop, q.seatPackage);
  const resultLine = qualifierResultText(q.result);

  // Local push when this qualifier transitions to running (rising edge), so a
  // registered player who backgrounded the tab gets nudged to their seat.
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (isRunning && !prevRunningRef.current && isRegistered) {
      if (typeof document === 'undefined' || document.visibilityState === 'hidden') {
        notify.tournamentStart(q.name);
      }
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, isRegistered, q.name]);

  const tabs = [{ key: 'overview', label: 'Overview' }];
  if (levels.length > 0) tabs.push({ key: 'blinds', label: 'Blind Schedule' });
  if (seatsLine || resultLine) tabs.push({ key: 'prizes', label: 'Seats' });

  const startCountdown = !isRunning && !isFinished ? formatCountdown(q.scheduledAt, now) : '';
  const stats = [
    { label: 'Registered', value: `${q.players}${q.maxPlayers ? `/${q.maxPlayers}` : ''}` },
    q.structure?.startingStack ? { label: 'Starting Stack', value: q.structure.startingStack.toLocaleString() } : null,
    levels[0] ? { label: 'Blinds Start', value: `${levels[0].sb}/${levels[0].bb}` } : null,
    levels.length ? { label: 'Levels', value: `${levels.length}${levels[0]?.minutes ? ` (${levels[0].minutes} min)` : ''}` } : null,
  ].filter(Boolean);

  const windowLines = [];
  if (q.scheduledAt != null) windowLines.push(`Starts ${formatWhen(q.scheduledAt)}.`);
  else windowLines.push('The start time has not been announced yet.');
  if (q.signupOpensAt != null && q.signupClosesAt != null) windowLines.push(`Signup is open from ${formatWhen(q.signupOpensAt)} to ${formatWhen(q.signupClosesAt)}.`);
  else if (q.signupOpensAt != null) windowLines.push(`Signup opens ${formatWhen(q.signupOpensAt)}.`);
  if (q.lateRegUntil != null) windowLines.push(`Late registration closes ${formatWhen(q.lateRegUntil)}.`);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(2,6,20,0.88)',
      zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
      padding: 'max(12px, env(safe-area-inset-top, 0px)) 12px max(12px, env(safe-area-inset-bottom, 0px))', overflowY: 'auto', boxSizing: 'border-box',
    }} onClick={onClose}>
      <div className="qualifier-dashboard" style={{
        width: '100%', maxWidth: 700, background: '#0d1929', boxSizing: 'border-box',
        borderRadius: 16, border: `1px solid ${color}33`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', minWidth: 0,
      }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: '2rem', lineHeight: 1 }}>{q.type === 'monthly' ? '🏆' : '🗓️'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, color: '#fff', fontSize: '1.15rem' }}>{q.name}</h2>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}55`, textTransform: 'uppercase' }}>{q.typeLabel}</span>
              {isRunning && <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'rgba(106,186,255,0.15)', color: '#6abaff', border: '1px solid rgba(106,186,255,0.4)' }}>LIVE</span>}
            </div>
            <div style={{ color: '#9fb4d8', fontSize: '0.8rem', marginTop: 4 }}>
              {q.scheduledAt != null ? formatWhen(q.scheduledAt) : 'Start time not announced yet'}
            </div>
            {startCountdown && <div style={{ color, fontWeight: 800, fontSize: '1rem', marginTop: 4 }}>Starts in {startCountdown}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: '#9fb4d8', fontSize: '1.4rem', cursor: 'pointer', padding: '0 6px', minWidth: 44, minHeight: 44 }}>✕</button>
        </div>

        {/* Stats bar — server values only */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1, background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {stats.map((stat) => (
            <div key={stat.label} style={{ padding: '10px 12px', textAlign: 'center', background: '#0d1929' }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.98rem' }}>{stat.value}</div>
              <div style={{ color: '#8298c4', fontSize: '0.68rem', textTransform: 'uppercase' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        {tabs.length > 1 && (
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                padding: '10px 16px', background: 'transparent', border: 'none', minHeight: 44,
                color: activeTab === t.key ? color : '#8298c4', cursor: 'pointer',
                fontWeight: activeTab === t.key ? 700 : 400, fontSize: '0.85rem',
                borderBottom: activeTab === t.key ? `2px solid ${color}` : '2px solid transparent', whiteSpace: 'nowrap',
              }}>{t.label}</button>
            ))}
          </div>
        )}

        <div style={{ padding: '16px', minHeight: 160 }}>
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {resultLine && (
                <div className="qualifier-result-line" style={{ padding: 12, borderRadius: 10, background: q.result?.wonSeat ? 'rgba(255,210,74,0.1)' : 'rgba(106,186,255,0.08)', border: `1px solid ${q.result?.wonSeat ? 'rgba(255,210,74,0.4)' : 'rgba(106,186,255,0.3)'}`, color: q.result?.wonSeat ? '#ffd24a' : '#cfe0ff', fontWeight: 700, textAlign: 'center' }}>
                  {resultLine}
                </div>
              )}
              <div style={{ color: '#cfe0ff', fontSize: '0.88rem', lineHeight: 1.6 }}>
                {q.type === 'monthly' ? (
                  <p style={{ margin: 0 }}>Monthly Major Qualifier — three ways in: (1) finish top 10% in any weekly online qualifier, (2) finish in the top 20% of each league's leaderboard (auto-added on the 1st), or (3) finish in the top 20% of your venue's average attendance.{seatsLine ? ` ${seatsLine} at the Championship.` : ''}</p>
                ) : (
                  <p style={{ margin: 0 }}>Top 5 finishers at any live American Pub Poker game earn a qualification credit for this weekly online qualifier.{seatsLine ? ` ${seatsLine} at the Championship at Bally's Blackhawk;` : ''} the top 10% advance to the monthly online qualifier.</p>
                )}
              </div>
              <div className="qualifier-window" style={{ color: '#9fb4d8', fontSize: '0.8rem', lineHeight: 1.6 }}>
                {windowLines.map((l) => <div key={l}>{l}</div>)}
                {state === 'unknown' && <div>Signup times have not been announced yet.</div>}
                {isRegistered && !isFinished && <div style={{ color: '#ffd24a', fontWeight: 600 }}>You are registered.</div>}
                {!isRegistered && isQualified && !isFinished && <div style={{ color: '#ffd24a' }}>You have a qualifier credit for this event.</div>}
              </div>
            </div>
          )}

          {activeTab === 'blinds' && levels.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: '#8298c4' }}>Level</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: '#8298c4' }}>Small</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: '#8298c4' }}>Big</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: '#8298c4' }}>Ante</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: '#8298c4' }}>Minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((b, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '8px 10px', color: '#fff' }}>{i + 1}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#fff' }}>{b.sb.toLocaleString()}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#fff' }}>{b.bb.toLocaleString()}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: b.ante ? '#fff' : '#5a6b8c' }}>{b.ante || '-'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#9fb4d8' }}>{b.minutes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'prizes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {q.seatsForTop ? Array.from({ length: Math.min(q.seatsForTop, 20) }, (_, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8,
                  background: q.result?.place === i + 1 ? 'rgba(255,210,74,0.12)' : 'rgba(255,255,255,0.02)',
                  border: q.result?.place === i + 1 ? '1px solid rgba(255,210,74,0.4)' : '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span style={{ color: '#fff', fontWeight: 700 }}>{ordinal(i + 1)}</span>
                  <span className="qualifier-seat-package-place" style={{ color: '#ffd24a' }}>
                    {(() => {
                      // 2026-10-21 — a seat package pays several seats per place.
                      const n = q.seatPackage ? (q.seatPackage[i + 1] || 0) : 1;
                      return n > 1 ? `${n} Championship Seats` : 'Championship Seat';
                    })()}
                  </span>
                </div>
              )) : null}
              {resultLine && <div style={{ color: '#cfe0ff', textAlign: 'center', marginTop: 6 }}>{resultLine}</div>}
            </div>
          )}
        </div>

        {/* Footer action — the card's own action area */}
        <div style={{ padding: '12px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {action}
        </div>
      </div>
    </div>
  );
}
