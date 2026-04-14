import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useQualifiers, qualifierActions } from '../../store/qualifierStore';
import { getSocket } from '../../services/socketService';
import { useTableStore } from '../../store/tableStore';

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
  const gameState = useTableStore((s) => s.gameState);
  const phone = gameState?.yourPhone || localStorage.getItem('poker_remember_phone') || '';
  const allQualifiers = useQualifiers();
  const qualifiers = allQualifiers.filter((q) => q.active).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  // Qualification status from server (fetched from master API)
  const [qualStatus, setQualStatus] = useState({ weekly: false, monthly: false });
  const [loading, setLoading] = useState(true);
  const [registeredIds, setRegisteredIds] = useState(new Set());

  // Fetch qualification status on mount
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !phone) { setLoading(false); return; }

    socket.emit('getQualifications', { phone });

    const handler = (data) => {
      setQualStatus(data);
      setLoading(false);
    };
    socket.on('qualifications', handler);
    return () => socket.off('qualifications', handler);
  }, [phone]);

  const handleRegister = (qualifier) => {
    const tier = qualifier.type?.toLowerCase(); // 'weekly' or 'monthly'
    const status = qualStatus[tier];

    if (!status || !status.qualified) return;

    qualifierActions.register(qualifier.id, playerName);
    setRegisteredIds((prev) => new Set([...prev, qualifier.id]));
    getSocket()?.emit('qualifierRegister', { qualifierId: qualifier.id, phone, playerName });
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
        const color = q.color || '#00D9FF';
        const tier = q.type?.toLowerCase();
        const status = qualStatus[tier];
        const isQualified = status && status.qualified;

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
              {isQualified && (
                <span style={{ color: '#4ADE80' }}>✓ {status.credits} qualification credit{status.credits > 1 ? 's' : ''}</span>
              )}
            </div>

            {loading ? (
              <div style={{ color: '#666', fontSize: '0.8rem', padding: '10px 0' }}>Checking qualification...</div>
            ) : isRegistered ? (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                color: '#4ADE80', fontSize: '0.85rem', fontWeight: 600,
              }}>
                ✓ You're registered for this qualifier
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
    </div>
  );
}
