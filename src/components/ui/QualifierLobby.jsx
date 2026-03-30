import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useQualifiers, qualifierActions } from '../../store/qualifierStore';
import { codeActions } from '../../store/codeStore';
import { getSocket } from '../../services/socketService';

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

export default function QualifierLobby() {
  const playerName = useGameStore((s) => s.playerName);
  const allQualifiers = useQualifiers();
  const qualifiers = allQualifiers.filter((q) => q.active).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const [codes, setCodes] = useState({});
  const [results, setResults] = useState({});
  const [registeredIds, setRegisteredIds] = useState(new Set());

  const handleRegister = (qualifier) => {
    const code = (codes[qualifier.id] || '').trim().toUpperCase();
    if (!code) {
      setResults((r) => ({ ...r, [qualifier.id]: { ok: false, msg: 'Enter your entry code.' } }));
      return;
    }

    // Always validate locally — codes are stored in localStorage
    const check = codeActions.validate(code, qualifier);
    if (check.valid) {
      codeActions.markUsed(code, playerName, qualifier.id);
      qualifierActions.register(qualifier.id, playerName);
      setRegisteredIds((prev) => new Set([...prev, qualifier.id]));
      setResults((r) => ({ ...r, [qualifier.id]: { ok: true, msg: 'Registered! See you at the table.' } }));
      // Notify server if connected (fire-and-forget)
      getSocket()?.emit('qualifierRegister', { qualifierId: qualifier.id, code, playerName });
    } else {
      setResults((r) => ({ ...r, [qualifier.id]: { ok: false, msg: check.reason } }));
    }
  };

  if (qualifiers.length === 0) {
    return (
      <div style={{ color: '#555', fontSize: '0.85rem', padding: '12px 0' }}>
        No active qualifiers at this time.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {qualifiers.map((q) => {
        const isRegistered = registeredIds.has(q.id);
        const result = results[q.id];
        const color = q.color || '#00D9FF';

        return (
          <div key={q.id} style={{
            background: 'linear-gradient(135deg, rgba(10,10,20,0.95), rgba(30,20,60,0.7))',
            border: `1px solid ${color}33`,
            borderRadius: 14,
            padding: '18px 20px',
          }}>
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
                </div>
                <div style={{ color: '#aaa', fontSize: '0.78rem', marginTop: 2 }}>
                  {new Date(q.scheduledAt).toUTCString().replace(' GMT', ' UTC')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color, fontWeight: 700, fontSize: '0.85rem' }}>{formatCountdown(q.scheduledAt)}</div>
                <div style={{ color: '#666', fontSize: '0.7rem' }}>until start</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: '0.78rem', color: '#aaa' }}>
              <span>🎰 Stack: <strong style={{ color: '#fff' }}>{(q.startingStack || 0).toLocaleString()}</strong></span>
              <span>👥 <strong style={{ color: '#fff' }}>{q.registered || 0}/{q.maxPlayers}</strong> registered</span>
              <span>🔑 Entry code required</span>
            </div>

            {isRegistered ? (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                color: '#4ADE80', fontSize: '0.85rem', fontWeight: 600,
              }}>
                ✓ You're registered for this qualifier
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Enter entry code"
                  value={codes[q.id] || ''}
                  maxLength={12}
                  onChange={(e) => setCodes((c) => ({ ...c, [q.id]: e.target.value.toUpperCase() }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister(q)}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem',
                    background: 'rgba(255,255,255,0.06)', border: `1px solid ${color}44`,
                    color: '#fff', outline: 'none', letterSpacing: '0.1em', fontFamily: 'monospace',
                  }}
                />
                <button onClick={() => handleRegister(q)} style={{
                  padding: '10px 18px', borderRadius: 8, fontWeight: 700, fontSize: '0.85rem',
                  background: `linear-gradient(135deg, ${color}, ${color}bb)`,
                  color: '#0a0a1a', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  Register
                </button>
              </div>
            )}

            {result && !isRegistered && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', fontWeight: 600, color: result.ok ? '#4ADE80' : '#F87171' }}>
                {result.ok ? '✓' : '✗'} {result.msg}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
