import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/gameStore';
import { useQualifiers, qualifierActions, DEFAULT_BLIND_STRUCTURE } from '../../store/qualifierStore';
import { useCodes, usePromos, codeActions } from '../../store/codeStore';
import { getSocket } from '../../services/socketService';
import './AdminDashboard.css';

// ── Constants ────────────────────────────────────────────────────────────────

const BLANK_QUALIFIER = {
  name: '', type: 'Weekly', icon: '🗓️',
  startingStack: 50000, maxPlayers: 999, scheduledAt: '', color: '#00D9FF',
  blindStructure: DEFAULT_BLIND_STRUCTURE, promotionId: null, recurrence: null,
};

const BLANK_RECURRENCE = { enabled: true, type: 'weekly', dayOfWeek: 6, time: '12:00', endDate: '' };

const BLANK_PROMO = { name: '', color: '#F59E0B', startDate: '', endDate: '' };

const BLIND_PRESETS = {
  turbo: [
    { type: 'level', sb: 25,   bb: 50,   ante: 0,    duration: 5 },
    { type: 'level', sb: 50,   bb: 100,  ante: 0,    duration: 5 },
    { type: 'level', sb: 100,  bb: 200,  ante: 25,   duration: 5 },
    { type: 'level', sb: 150,  bb: 300,  ante: 25,   duration: 5 },
    { type: 'level', sb: 200,  bb: 400,  ante: 50,   duration: 5 },
    { type: 'break', duration: 5 },
    { type: 'level', sb: 300,  bb: 600,  ante: 75,   duration: 5 },
    { type: 'level', sb: 400,  bb: 800,  ante: 100,  duration: 5 },
    { type: 'level', sb: 600,  bb: 1200, ante: 150,  duration: 5 },
    { type: 'level', sb: 800,  bb: 1600, ante: 200,  duration: 5 },
    { type: 'level', sb: 1000, bb: 2000, ante: 300,  duration: 5 },
    { type: 'break', duration: 5 },
    { type: 'level', sb: 1500, bb: 3000, ante: 500,  duration: 5 },
    { type: 'level', sb: 2000, bb: 4000, ante: 500,  duration: 5 },
    { type: 'level', sb: 3000, bb: 6000, ante: 1000, duration: 5 },
  ],
  regular: DEFAULT_BLIND_STRUCTURE,
  deepStack: [
    { type: 'level', sb: 25,   bb: 50,   ante: 0,    duration: 25 },
    { type: 'level', sb: 50,   bb: 100,  ante: 0,    duration: 25 },
    { type: 'level', sb: 75,   bb: 150,  ante: 0,    duration: 25 },
    { type: 'level', sb: 100,  bb: 200,  ante: 25,   duration: 25 },
    { type: 'level', sb: 150,  bb: 300,  ante: 25,   duration: 25 },
    { type: 'level', sb: 200,  bb: 400,  ante: 50,   duration: 25 },
    { type: 'break', duration: 15 },
    { type: 'level', sb: 300,  bb: 600,  ante: 75,   duration: 25 },
    { type: 'level', sb: 400,  bb: 800,  ante: 100,  duration: 25 },
    { type: 'level', sb: 500,  bb: 1000, ante: 125,  duration: 25 },
    { type: 'level', sb: 600,  bb: 1200, ante: 150,  duration: 25 },
    { type: 'level', sb: 800,  bb: 1600, ante: 200,  duration: 25 },
    { type: 'break', duration: 15 },
    { type: 'level', sb: 1000, bb: 2000, ante: 300,  duration: 25 },
    { type: 'level', sb: 1500, bb: 3000, ante: 500,  duration: 25 },
    { type: 'level', sb: 2000, bb: 4000, ante: 500,  duration: 25 },
    { type: 'level', sb: 3000, bb: 6000, ante: 1000, duration: 25 },
    { type: 'level', sb: 4000, bb: 8000, ante: 1000, duration: 25 },
    { type: 'break', duration: 15 },
    { type: 'level', sb: 5000, bb: 10000, ante: 2000, duration: 25 },
  ],
};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function toLocalDTInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminDashboard({ onClose }) {
  const playerName = useGameStore((s) => s.playerName);

  // ── Tab ──
  const [adminTab, setAdminTab] = useState('overview');

  // ── Qualifier state ──
  const qualifiers = useQualifiers();
  const [qEditing, setQEditing] = useState(null);
  const [qForm, setQForm] = useState(BLANK_QUALIFIER);
  const [openRegistrants, setOpenRegistrants] = useState(null);

  // ── Code & Promo state ──
  const allCodes  = useCodes();
  const promos    = usePromos();
  const [codeFilter, setCodeFilter]       = useState('all'); // 'all' | type | promoId
  const [genPromoId, setGenPromoId]       = useState('');       // '' = no promo
  const [genQualType, setGenQualType]     = useState('Weekly'); // 'Weekly' | 'Monthly'
  const [genCount, setGenCount]           = useState(500);
  const [copiedCode, setCopiedCode]       = useState(null);
  const [copiedAll, setCopiedAll]         = useState(false);
  const [promoEditing, setPromoEditing]   = useState(null); // null | 'new' | id
  const [promoForm, setPromoForm]         = useState(BLANK_PROMO);

  const openNewQ = () => { setQForm(BLANK_QUALIFIER); setQEditing('new'); };
  const openEditQ = (q) => { setQForm({ ...q, blindStructure: q.blindStructure || [], promotionId: q.promotionId || null, recurrence: q.recurrence || null }); setQEditing(q.id); };
  const closeQ = () => { setQEditing(null); setQForm(BLANK_QUALIFIER); };
  const saveQ = () => {
    if (!qForm.name.trim() || !qForm.scheduledAt) return;
    if (qEditing === 'new') qualifierActions.add(qForm); else qualifierActions.update(qEditing, qForm);
    closeQ();
  };
  // ── Promotion helpers ──
  const openNewPromo  = () => { setPromoForm(BLANK_PROMO); setPromoEditing('new'); };
  const openEditPromo = (p) => { setPromoForm({ ...p }); setPromoEditing(p.id); };
  const closePromo    = () => { setPromoEditing(null); setPromoForm(BLANK_PROMO); };
  const savePromo     = () => {
    if (!promoForm.name.trim()) return;
    if (promoEditing === 'new') codeActions.addPromo(promoForm); else codeActions.updatePromo(promoEditing, promoForm);
    closePromo();
  };

  const cloneQ = (q) => qualifierActions.add({ ...q, name: q.name + ' (Copy)', active: false, registered: 0, registrants: [], templateId: null });

  const setRec = (field, val) => setQForm((f) => ({
    ...f,
    recurrence: { ...(f.recurrence || BLANK_RECURRENCE), [field]: val },
  }));

  const writeClipboard = (text) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  };
  const legacyCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  };
  const copyToClipboard = (text) => {
    writeClipboard(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const handleGenCodes = () => {
    const promo = promos.find((p) => p.id === genPromoId);
    const expiresAt = promo?.endDate ? new Date(promo.endDate + 'T23:59:59Z').toISOString() : null;
    codeActions.generate({
      count:         genCount,
      qualifierType: genQualType,
      promotionId:   genPromoId || null,
      expiresAt,
    });
  };

  // ── Blind structure helpers ──
  const addBlindRow = () => setQForm((f) => {
    const bs = f.blindStructure || [];
    const last = [...bs].reverse().find((r) => r.type !== 'break');
    const row = last
      ? { type: 'level', sb: last.sb * 2, bb: last.bb * 2, ante: last.ante ? last.ante * 2 : 0, duration: last.duration }
      : { type: 'level', sb: 25, bb: 50, ante: 0, duration: 20 };
    return { ...f, blindStructure: [...bs, row] };
  });
  const addBreakRow = () => setQForm((f) => ({ ...f, blindStructure: [...(f.blindStructure || []), { type: 'break', duration: 15 }] }));
  const updateBlindRow = (idx, field, val) => setQForm((f) => {
    const bs = [...(f.blindStructure || [])];
    bs[idx] = { ...bs[idx], [field]: parseInt(val) || 0 };
    return { ...f, blindStructure: bs };
  });
  const removeBlindRow = (idx) => setQForm((f) => ({ ...f, blindStructure: (f.blindStructure || []).filter((_, i) => i !== idx) }));
  const moveBlindRow = (idx, dir) => setQForm((f) => {
    const bs = [...(f.blindStructure || [])];
    const t = idx + dir;
    if (t < 0 || t >= bs.length) return f;
    [bs[idx], bs[t]] = [bs[t], bs[idx]];
    return { ...f, blindStructure: bs };
  });
  const applyPreset = (key) => setQForm((f) => ({ ...f, blindStructure: BLIND_PRESETS[key].map((r) => ({ ...r })) }));

  // ── Admin stats ──
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [activeTables, setActiveTables] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [chipAdj, setChipAdj] = useState({ userId: null, amount: '', reason: '' });
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastSent, setBroadcastSent] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('getAdminStats');
    const handleStats = (data) => {
      if (data.error) { setIsAdmin(false); setLoading(false); return; }
      setIsAdmin(true); setStats(data); setUsers(data.users || []);
      setActiveTables(data.tables || []); setLoading(false);
    };
    socket.on('adminStats', handleStats);
    return () => socket.off('adminStats', handleStats);
  }, []);

  const handleBan = (id) => { getSocket()?.emit('banUser', { userId: id }); setUsers((p) => p.map((u) => u.id === id ? { ...u, banned: true } : u)); };
  const handleUnban = (id) => { getSocket()?.emit('unbanUser', { userId: id }); setUsers((p) => p.map((u) => u.id === id ? { ...u, banned: false } : u)); };
  const handleKick = (id) => { getSocket()?.emit('adminKickPlayer', { userId: id }); };
  const handleIPBan = (id) => { getSocket()?.emit('adminIPBan', { userId: id }); setUsers((p) => p.map((u) => u.id === id ? { ...u, banned: true } : u)); };
  const handleToggleAdmin = (id) => { getSocket()?.emit('adminToggleAdmin', { userId: id }); setUsers((p) => p.map((u) => u.id === id ? { ...u, isAdmin: !u.isAdmin } : u)); };
  const handleAdjustChips = () => {
    if (!chipAdj.userId || !chipAdj.amount) return;
    getSocket()?.emit('adminAdjustChips', { userId: chipAdj.userId, amount: parseInt(chipAdj.amount), reason: chipAdj.reason });
    setUsers((p) => p.map((u) => u.id === chipAdj.userId ? { ...u, chips: (u.chips || 0) + parseInt(chipAdj.amount) } : u));
    setChipAdj({ userId: null, amount: '', reason: '' });
  };
  const handleBroadcast = () => {
    if (!broadcastMsg.trim()) return;
    getSocket()?.emit('adminBroadcast', { message: broadcastMsg });
    setBroadcastSent(true); setBroadcastMsg('');
    setTimeout(() => setBroadcastSent(false), 3000);
  };
  const handleMaintenance = () => {
    const next = !maintenanceMode;
    setMaintenanceMode(next);
    getSocket()?.emit('adminMaintenance', { enabled: next });
  };
  const handleForceCloseTable = (tableId) => { getSocket()?.emit('adminForceCloseTable', { tableId }); setActiveTables((p) => p.filter((t) => t.id !== tableId)); };

  const filteredUsers = users.filter((u) => u.username?.toLowerCase().includes(searchQuery.toLowerCase()));

  // ── Shared styles ──
  const inp = {
    width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: '0.82rem',
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', outline: 'none', boxSizing: 'border-box',
  };
  const smInp = {
    width: '100%', padding: '4px 6px', borderRadius: 5, fontSize: '0.75rem',
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', outline: 'none', boxSizing: 'border-box', textAlign: 'center',
  };
  const lbl = { color: '#8888AA', fontSize: '0.72rem', marginBottom: 3, display: 'block' };
  const colH = { color: '#555', fontSize: '0.65rem', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' };
  const secTitle = { color: '#00D9FF', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 16, display: 'block' };
  const btn = (bg, color, border) => ({ padding: '6px 14px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, background: bg, color, border: `1px solid ${border}`, cursor: 'pointer' });

  // ── Tab button style ──
  const tabBtn = (active) => ({
    padding: '6px 14px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
    background: active ? 'rgba(0,217,255,0.15)' : 'rgba(255,255,255,0.05)',
    color: active ? '#00D9FF' : '#666',
    border: active ? '1px solid rgba(0,217,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
  });

  // ════════════════════════════════════════════════════════
  // TAB: OVERVIEW
  // ════════════════════════════════════════════════════════
  const renderOverview = () => (
    <>
      <div className="admin-stats-grid">
        {[
          [stats?.totalUsers || 0, 'Total Users'],
          [stats?.activeConnections || 0, 'Active Now'],
          [stats?.tablesRunning || activeTables.length || 0, 'Tables'],
          [stats?.handsPlayedToday || 0, 'Hands Today'],
        ].map(([val, label]) => (
          <div key={label} className="admin-stat-card">
            <div className="admin-stat-value">{val}</div>
            <div className="admin-stat-label">{label}</div>
          </div>
        ))}
      </div>

      <span style={secTitle}>Server Stats</span>
      <div className="admin-server-stats">
        <div className="admin-server-stat"><span className="admin-server-stat-label">Uptime</span><span className="admin-server-stat-value">{stats?.uptime || 'N/A'}</span></div>
        <div className="admin-server-stat"><span className="admin-server-stat-label">Memory</span><span className="admin-server-stat-value">{stats?.memoryUsage || 'N/A'}</span></div>
      </div>

      <span style={secTitle}>Broadcast Message</span>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input style={inp} placeholder="Send a message to all connected players..." value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleBroadcast()} />
        <button onClick={handleBroadcast} style={{ ...btn(broadcastSent ? 'rgba(74,222,128,0.2)' : 'linear-gradient(135deg,#00D9FF,#0099BB)', broadcastSent ? '#4ADE80' : '#0a0a1a', 'transparent'), whiteSpace: 'nowrap' }}>
          {broadcastSent ? '✓ Sent' : 'Send'}
        </button>
      </div>

      <span style={secTitle}>Server Controls</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleMaintenance} style={{
          ...btn(maintenanceMode ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.06)', maintenanceMode ? '#F87171' : '#aaa', maintenanceMode ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)'),
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: maintenanceMode ? '#F87171' : '#555', display: 'inline-block' }} />
          {maintenanceMode ? 'Maintenance: ON' : 'Maintenance: OFF'}
        </button>
        <span style={{ color: '#555', fontSize: '0.72rem' }}>
          {maintenanceMode ? 'New logins are blocked. Players will see a maintenance message.' : 'Server is open to players.'}
        </span>
      </div>
    </>
  );

  // ════════════════════════════════════════════════════════
  // TAB: QUALIFIERS
  // ════════════════════════════════════════════════════════
  const renderQualifiers = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: '#aaa', fontSize: '0.82rem' }}>{qualifiers.length} qualifier{qualifiers.length !== 1 ? 's' : ''}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => qualifierActions.syncRecurring()} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.12)')}>↻ Sync</button>
          <button onClick={openNewQ} style={btn('linear-gradient(135deg,#00D9FF,#0099BB)', '#0a0a1a', 'transparent')}>+ Add Qualifier</button>
        </div>
      </div>

      {/* Qualifier list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {[...qualifiers].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)).map((q) => (
          <div key={q.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', opacity: q.active ? 1 : 0.55 }}>
            {/* Header row */}
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.3rem' }}>{q.icon || '🏆'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {q.name}
                  <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 10, background: `${q.color || '#00D9FF'}22`, color: q.color || '#00D9FF', border: `1px solid ${q.color || '#00D9FF'}44` }}>{q.type}</span>
                  {q.recurrence?.enabled && <span style={{ fontSize: '0.6rem', color: '#4ADE80', background: 'rgba(74,222,128,0.1)', padding: '1px 6px', borderRadius: 10, border: '1px solid rgba(74,222,128,0.3)' }}>↻ TEMPLATE</span>}
                  {q.templateId && <span style={{ fontSize: '0.6rem', color: '#FBBF24', background: 'rgba(251,191,36,0.1)', padding: '1px 6px', borderRadius: 10, border: '1px solid rgba(251,191,36,0.3)' }}>↻ AUTO</span>}
                  {!q.active && <span style={{ fontSize: '0.6rem', color: '#F87171', background: 'rgba(248,113,113,0.1)', padding: '1px 6px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.3)' }}>HIDDEN</span>}
                </div>
                <div style={{ color: '#666', fontSize: '0.72rem', marginTop: 2 }}>
                  {new Date(q.scheduledAt).toUTCString().replace(' GMT', ' UTC')} · Stack {(q.startingStack || 0).toLocaleString()} · Max {q.maxPlayers} · {(q.blindStructure || []).length} blind rows
                    {q.promotionId && (() => { const p = promos.find((x) => x.id === q.promotionId); return p ? <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 8, background: `${p.color || '#F59E0B'}22`, color: p.color || '#F59E0B', border: `1px solid ${p.color || '#F59E0B'}44`, fontSize: '0.62rem' }}>🎟 {p.name}</span> : null; })()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button onClick={() => setOpenRegistrants(openRegistrants === q.id ? null : q.id)} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.12)')}>
                  👥 {q.registered || 0}
                </button>
                <button onClick={() => qualifierActions.toggleActive(q.id)} style={btn(q.active ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)', q.active ? '#F87171' : '#4ADE80', q.active ? 'rgba(248,113,113,0.3)' : 'rgba(74,222,128,0.3)')}>
                  {q.active ? 'Hide' : 'Show'}
                </button>
                <button onClick={() => cloneQ(q)} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.12)')}>Clone</button>
                <button onClick={() => openEditQ(q)} style={btn('rgba(255,255,255,0.08)', '#ccc', 'rgba(255,255,255,0.12)')}>Edit</button>
                <button onClick={() => qualifierActions.delete(q.id)} style={btn('rgba(248,113,113,0.1)', '#F87171', 'rgba(248,113,113,0.25)')}>Delete</button>
              </div>
            </div>

            {/* Registrants panel */}
            {openRegistrants === q.id && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 14px', background: 'rgba(0,0,0,0.3)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#aaa', marginBottom: 8 }}>
                  Registrants ({(q.registrants || []).length}/{q.maxPlayers})
                </div>
                {(q.registrants || []).length === 0
                  ? <div style={{ color: '#444', fontSize: '0.75rem' }}>No registrants yet.</div>
                  : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(q.registrants || []).map((r) => (
                        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '4px 8px', fontSize: '0.75rem', color: '#ccc' }}>
                          {r}
                          <button onClick={() => qualifierActions.removeRegistrant(q.id, r)}
                            style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}

          </div>
        ))}
        {qualifiers.length === 0 && <div style={{ color: '#555', fontSize: '0.82rem', textAlign: 'center', padding: '12px 0' }}>No qualifiers yet.</div>}
      </div>

      {/* Edit / New form */}
      {qEditing && (
        <div style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(0,217,255,0.2)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#00D9FF', marginBottom: 14 }}>
            {qEditing === 'new' ? 'New Qualifier' : 'Edit Qualifier'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 14 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Name</label>
              <input style={inp} value={qForm.name} onChange={(e) => setQForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Weekly Qualifier" />
            </div>
            <div>
              <label style={lbl}>Type</label>
              <select style={inp} value={qForm.type} onChange={(e) => setQForm((f) => ({ ...f, type: e.target.value }))}>
                <option>Weekly</option><option>Monthly</option><option>Special</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Icon (emoji)</label>
              <input style={inp} value={qForm.icon} onChange={(e) => setQForm((f) => ({ ...f, icon: e.target.value }))} placeholder="🏆" maxLength={4} />
            </div>
            <div>
              <label style={lbl}>Starting Stack</label>
              <input style={inp} type="number" min={100} step={1000} value={qForm.startingStack} onChange={(e) => setQForm((f) => ({ ...f, startingStack: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={lbl}>Max Players</label>
              <input style={inp} type="number" min={2} max={9999} value={qForm.maxPlayers} onChange={(e) => setQForm((f) => ({ ...f, maxPlayers: parseInt(e.target.value) || 9 }))} />
            </div>
            <div>
              <label style={lbl}>Date & Time (local)</label>
              <input style={inp} type="datetime-local" value={toLocalDTInput(qForm.scheduledAt)}
                onChange={(e) => setQForm((f) => ({ ...f, scheduledAt: new Date(e.target.value).toISOString() }))} />
            </div>
            <div>
              <label style={lbl}>Accent Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={qForm.color || '#00D9FF'} onChange={(e) => setQForm((f) => ({ ...f, color: e.target.value }))}
                  style={{ width: 36, height: 36, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                <input style={{ ...inp, flex: 1 }} value={qForm.color || ''} onChange={(e) => setQForm((f) => ({ ...f, color: e.target.value }))} placeholder="#00D9FF" />
              </div>
            </div>
            <div>
              <label style={lbl}>Promotion (optional)</label>
              <select style={inp} value={qForm.promotionId || ''} onChange={(e) => setQForm((f) => ({ ...f, promotionId: e.target.value || null }))}>
                <option value="">— None —</option>
                {promos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* Blind Structure */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ color: '#8888AA', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Blind Structure</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <select onChange={(e) => e.target.value && applyPreset(e.target.value)} defaultValue=""
                  style={{ ...inp, width: 'auto', padding: '4px 8px', fontSize: '0.72rem' }}>
                  <option value="" disabled>Preset…</option>
                  <option value="turbo">Turbo (5 min)</option>
                  <option value="regular">Regular (20 min)</option>
                  <option value="deepStack">Deep Stack (25 min)</option>
                </select>
                <button onClick={addBlindRow} style={btn('rgba(0,217,255,0.12)', '#00D9FF', 'rgba(0,217,255,0.25)')}>+ Level</button>
                <button onClick={addBreakRow} style={btn('rgba(251,191,36,0.12)', '#FBBF24', 'rgba(251,191,36,0.25)')}>+ Break</button>
              </div>
            </div>

            {(qForm.blindStructure || []).length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 1fr 44px 28px', gap: 4, padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  {['#','SB','BB','Ante','Mins','Move',''].map((h, i) => <span key={i} style={colH}>{h}</span>)}
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 8px 6px' }}>
                  {(() => {
                    let lvl = 0;
                    return (qForm.blindStructure || []).map((row, idx) => {
                      const isBreak = row.type === 'break';
                      if (!isBreak) lvl++;
                      const last = idx === (qForm.blindStructure || []).length - 1;
                      const moveBtns = (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {[[-1, '▲'], [1, '▼']].map(([d, sym]) => (
                            <button key={d} onClick={() => moveBlindRow(idx, d)} disabled={d === -1 ? idx === 0 : last}
                              style={{ width: 20, height: 18, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', padding: 0, cursor: (d === -1 ? idx === 0 : last) ? 'default' : 'pointer', background: (d === -1 ? idx === 0 : last) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)', color: (d === -1 ? idx === 0 : last) ? '#333' : '#aaa', border: '1px solid rgba(255,255,255,0.1)' }}>{sym}</button>
                          ))}
                        </div>
                      );
                      const delBtn = (
                        <button onClick={() => removeBlindRow(idx)} style={{ width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,113,113,0.1)', color: '#F87171', border: '1px solid rgba(248,113,113,0.25)', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>×</button>
                      );
                      return isBreak ? (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 1fr 44px 28px', gap: 4, marginBottom: 3, alignItems: 'center', background: 'rgba(251,191,36,0.05)', borderRadius: 5, padding: '2px 0' }}>
                          <span style={{ color: '#FBBF24', fontSize: '0.6rem', textAlign: 'center', fontWeight: 700 }}>BRK</span>
                          <span style={{ color: '#555', fontSize: '0.68rem', textAlign: 'center', gridColumn: '2 / 5' }}>— break —</span>
                          <input type="number" style={{ ...smInp, border: '1px solid rgba(251,191,36,0.25)' }} value={row.duration} min={1} onChange={(e) => updateBlindRow(idx, 'duration', e.target.value)} />
                          {moveBtns}{delBtn}
                        </div>
                      ) : (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 1fr 44px 28px', gap: 4, marginBottom: 3, alignItems: 'center' }}>
                          <span style={{ color: '#444', fontSize: '0.68rem', textAlign: 'center' }}>{lvl}</span>
                          {['sb','bb','ante','duration'].map((f) => (
                            <input key={f} type="number" style={smInp} value={row[f]} min={f === 'ante' ? 0 : 1} onChange={(e) => updateBlindRow(idx, f, e.target.value)} />
                          ))}
                          {moveBtns}{delBtn}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
            {(qForm.blindStructure || []).length === 0 && (
              <div style={{ color: '#444', fontSize: '0.78rem', padding: '10px 0', textAlign: 'center' }}>No levels yet — click + Level or choose a preset</div>
            )}
          </div>

          {/* Auto-Schedule / Recurrence */}
          {!qForm.templateId && (
            <div style={{ marginBottom: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ color: '#8888AA', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Auto-Schedule</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={!!qForm.recurrence?.enabled}
                    onChange={(e) => setQForm((f) => ({
                      ...f,
                      recurrence: e.target.checked ? { ...BLANK_RECURRENCE, type: f.type === 'Monthly' ? 'monthly-3rd-sunday' : 'weekly' } : null,
                    }))}
                  />
                  <span style={{ color: '#ccc', fontSize: '0.8rem' }}>Auto-generate recurring occurrences</span>
                </label>
              </div>

              {qForm.recurrence?.enabled && (
                <div style={{ background: 'rgba(0,217,255,0.05)', border: '1px solid rgba(0,217,255,0.15)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px 14px', marginBottom: 8 }}>
                    <div>
                      <label style={lbl}>Pattern</label>
                      <select style={inp} value={qForm.recurrence.type || 'weekly'} onChange={(e) => setRec('type', e.target.value)}>
                        <option value="weekly">Weekly</option>
                        <option value="monthly-3rd-sunday">Monthly (3rd Sunday)</option>
                      </select>
                    </div>
                    {(qForm.recurrence.type || 'weekly') === 'weekly' && (
                      <div>
                        <label style={lbl}>Day of Week</label>
                        <select style={inp} value={qForm.recurrence.dayOfWeek ?? 6} onChange={(e) => setRec('dayOfWeek', parseInt(e.target.value))}>
                          {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                            <option key={i} value={i}>{d}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label style={lbl}>Time (UTC)</label>
                      <input style={inp} type="time" value={qForm.recurrence.time || '12:00'} onChange={(e) => setRec('time', e.target.value)} />
                    </div>
                    <div>
                      <label style={lbl}>End Date</label>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <input style={inp} type="date" value={qForm.recurrence.endDate || ''} onChange={(e) => setRec('endDate', e.target.value)} />
                        {qForm.promotionId && (() => {
                          const p = promos.find((x) => x.id === qForm.promotionId);
                          return p?.endDate ? (
                            <button type="button" onClick={() => setRec('endDate', p.endDate)}
                              style={{ ...btn('rgba(251,191,36,0.12)', '#FBBF24', 'rgba(251,191,36,0.25)'), whiteSpace: 'nowrap', fontSize: '0.68rem' }}>
                              Use promo
                            </button>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: '#555', fontSize: '0.7rem' }}>
                    {qForm.recurrence.type === 'monthly-3rd-sunday'
                      ? 'Generates one instance on the 3rd Sunday of each month until the end date.'
                      : `Generates one instance every ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][qForm.recurrence.dayOfWeek ?? 6]} until the end date.`}
                    {' '}Lookahead capped at 6 months.
                  </div>
                </div>
              )}
            </div>
          )}
          {qForm.templateId && (
            <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', color: '#FBBF24', fontSize: '0.75rem' }}>
              ↻ This is an auto-generated instance. Edit the template to change recurrence settings.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={closeQ} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.1)')}>Cancel</button>
            <button onClick={saveQ} style={btn('linear-gradient(135deg,#00D9FF,#0099BB)', '#0a0a1a', 'transparent')}>Save</button>
          </div>
        </div>
      )}
    </>
  );

  // ════════════════════════════════════════════════════════
  // TAB: TABLES
  // ════════════════════════════════════════════════════════
  const renderTables = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: '#aaa', fontSize: '0.82rem' }}>{activeTables.length} active table{activeTables.length !== 1 ? 's' : ''}</span>
        <button onClick={() => { const s = getSocket(); s?.emit('getAdminStats'); }} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.12)')}>↻ Refresh</button>
      </div>
      {activeTables.length === 0
        ? <div style={{ color: '#555', fontSize: '0.82rem', textAlign: 'center', padding: '24px 0' }}>No active tables.</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeTables.map((t) => (
              <div key={t.id || t.name} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>{t.name || `Table ${t.id}`}</div>
                  <div style={{ color: '#666', fontSize: '0.72rem', marginTop: 2 }}>
                    {t.players || 0}/{t.maxPlayers || 9} seats · {t.stakes || 'N/A'} · {t.variant || 'Hold\'em'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleForceCloseTable(t.id)} style={btn('rgba(248,113,113,0.1)', '#F87171', 'rgba(248,113,113,0.25)')}>Force Close</button>
                </div>
              </div>
            ))}
          </div>
      }
    </>
  );

  // ════════════════════════════════════════════════════════
  // TAB: USERS
  // ════════════════════════════════════════════════════════
  const renderUsers = () => (
    <>
      <input className="admin-user-search" type="text" placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

      {/* Chip adjustment modal */}
      {chipAdj.userId && (
        <div style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#FBBF24', marginBottom: 10 }}>
            Adjust Chips — {users.find((u) => u.id === chipAdj.userId)?.username}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={lbl}>Amount (+ add / − remove)</label>
              <input style={inp} type="number" placeholder="e.g. 5000 or -1000" value={chipAdj.amount} onChange={(e) => setChipAdj((a) => ({ ...a, amount: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Reason</label>
              <input style={inp} placeholder="e.g. Tournament prize, refund..." value={chipAdj.reason} onChange={(e) => setChipAdj((a) => ({ ...a, reason: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setChipAdj({ userId: null, amount: '', reason: '' })} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.1)')}>Cancel</button>
            <button onClick={handleAdjustChips} style={btn('rgba(251,191,36,0.2)', '#FBBF24', 'rgba(251,191,36,0.35)')}>Apply</button>
          </div>
        </div>
      )}

      <div className="admin-user-list">
        {filteredUsers.map((user) => (
          <div key={user.id}>
            <div className="admin-user-row" style={{ cursor: 'pointer' }} onClick={() => setSelectedUser(selectedUser?.id === user.id ? null : user)}>
              <div className="admin-user-info">
                <div className="admin-user-avatar">{user.username?.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="admin-user-name">{user.username}{user.isAdmin && ' 👑'}</div>
                  <div className="admin-user-meta">{(user.chips || 0).toLocaleString()} chips · Lv.{user.level || 1}</div>
                </div>
              </div>
              <div className="admin-user-actions">
                {user.banned && <span className="admin-user-banned">Banned</span>}
                <span style={{ color: '#444', fontSize: '0.65rem' }}>{selectedUser?.id === user.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* User detail drawer */}
            {selectedUser?.id === user.id && (
              <div style={{ background: 'rgba(0,0,0,0.4)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                  {[
                    ['Chips', (user.chips || 0).toLocaleString()],
                    ['Level', user.level || 1],
                    ['XP', (user.xp || 0).toLocaleString()],
                    ['Hands Played', user.handsPlayed || 0],
                    ['Win Rate', user.winRate ? `${user.winRate}%` : 'N/A'],
                    ['Status', user.banned ? '🚫 Banned' : user.isAdmin ? '👑 Admin' : '✓ Active'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 7, padding: '8px 10px' }}>
                      <div style={{ color: '#555', fontSize: '0.65rem', marginBottom: 2 }}>{k}</div>
                      <div style={{ color: '#ccc', fontSize: '0.82rem', fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => setChipAdj({ userId: user.id, amount: '', reason: '' })} style={btn('rgba(251,191,36,0.12)', '#FBBF24', 'rgba(251,191,36,0.25)')}>Adjust Chips</button>
                  {!user.isAdmin && (
                    user.banned
                      ? <button onClick={() => handleUnban(user.id)} style={btn('rgba(74,222,128,0.15)', '#4ADE80', 'rgba(74,222,128,0.3)')}>Unban</button>
                      : <button onClick={() => handleBan(user.id)} style={btn('rgba(248,113,113,0.15)', '#F87171', 'rgba(248,113,113,0.3)')}>Ban</button>
                  )}
                  <button onClick={() => handleIPBan(user.id)} style={btn('rgba(248,113,113,0.1)', '#F87171', 'rgba(248,113,113,0.2)')}>IP Ban</button>
                  <button onClick={() => handleKick(user.id)} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.12)')}>Kick</button>
                  <button onClick={() => handleToggleAdmin(user.id)} style={btn('rgba(251,191,36,0.08)', '#FBBF24', 'rgba(251,191,36,0.2)')}>
                    {user.isAdmin ? 'Remove Admin' : 'Make Admin'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: '#555' }}>No users found</div>}
      </div>
    </>
  );

  // ════════════════════════════════════════════════════════
  // TAB: CODES & PROMOS
  // ════════════════════════════════════════════════════════
  const renderCodes = () => {
    const displayCodes = codeFilter === 'all'
      ? allCodes
      : codeFilter === 'unused'
        ? allCodes.filter((c) => !c.usedBy)
        : allCodes.filter((c) => c.qualifierType === codeFilter || c.promotionId === codeFilter);

    return (
      <>
        {/* Promotions */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={secTitle}>Promotions</span>
            <button onClick={openNewPromo} style={btn('rgba(251,191,36,0.15)', '#FBBF24', 'rgba(251,191,36,0.3)')}>+ New Promo</button>
          </div>

          {promoEditing && (
            <div style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#FBBF24', marginBottom: 12 }}>
                {promoEditing === 'new' ? 'New Promotion' : 'Edit Promotion'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={lbl}>Name</label>
                  <input style={inp} value={promoForm.name} onChange={(e) => setPromoForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Spring Series" />
                </div>
                <div>
                  <label style={lbl}>Color</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={promoForm.color || '#F59E0B'} onChange={(e) => setPromoForm((f) => ({ ...f, color: e.target.value }))}
                      style={{ width: 32, height: 32, borderRadius: 5, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                    <input style={{ ...inp, flex: 1 }} value={promoForm.color || ''} onChange={(e) => setPromoForm((f) => ({ ...f, color: e.target.value }))} placeholder="#F59E0B" />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Start Date</label>
                  <input style={inp} type="date" value={promoForm.startDate || ''} onChange={(e) => setPromoForm((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>End Date</label>
                  <input style={inp} type="date" value={promoForm.endDate || ''} onChange={(e) => setPromoForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={closePromo} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.1)')}>Cancel</button>
                <button onClick={savePromo} style={btn('rgba(251,191,36,0.2)', '#FBBF24', 'rgba(251,191,36,0.35)')}>Save</button>
              </div>
            </div>
          )}

          {promos.length === 0 ? (
            <div style={{ color: '#555', fontSize: '0.8rem', padding: '8px 0' }}>No promotions yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {promos.map((p) => {
                const promoQualifiers = qualifiers.filter((q) => q.promotionId === p.id);
                const promoCodes = allCodes.filter((c) => c.promotionId === p.id);
                return (
                  <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${p.color || '#F59E0B'}33`, borderRadius: 9, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color || '#F59E0B', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{p.name}</div>
                      <div style={{ color: '#666', fontSize: '0.7rem', marginTop: 2 }}>
                        {p.startDate && p.endDate ? `${p.startDate} → ${p.endDate} · ` : ''}{promoQualifiers.length} qualifier{promoQualifiers.length !== 1 ? 's' : ''} · {promoCodes.length} code{promoCodes.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => openEditPromo(p)} style={btn('rgba(255,255,255,0.06)', '#aaa', 'rgba(255,255,255,0.12)')}>Edit</button>
                      <button onClick={() => codeActions.deletePromo(p.id)} style={btn('rgba(248,113,113,0.1)', '#F87171', 'rgba(248,113,113,0.25)')}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Code Generation */}
        <span style={secTitle}>Generate Entry Codes</span>
        <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,217,255,0.15)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
            <div>
              <label style={lbl}>Promotion (optional)</label>
              <select style={inp} value={genPromoId} onChange={(e) => setGenPromoId(e.target.value)}>
                <option value="">— None —</option>
                {promos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Qualifier Type</label>
              <div style={{ display: 'flex', gap: 5 }}>
                {['Weekly', 'Monthly'].map((t) => (
                  <button key={t} type="button" onClick={() => setGenQualType(t)} style={{
                    flex: 1, padding: '8px 6px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                    background: genQualType === t ? 'rgba(0,217,255,0.18)' : 'rgba(255,255,255,0.05)',
                    color: genQualType === t ? '#00D9FF' : '#666',
                    border: genQualType === t ? '1px solid rgba(0,217,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  }}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl}>Count</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[500, 1000, 5000, 10000].map((n) => (
                  <button key={n} type="button" onClick={() => setGenCount(n)} style={{
                    padding: '6px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                    background: genCount === n ? 'rgba(0,217,255,0.18)' : 'rgba(255,255,255,0.05)',
                    color: genCount === n ? '#00D9FF' : '#666',
                    border: genCount === n ? '1px solid rgba(0,217,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  }}>{n >= 1000 ? `${n/1000}k` : n}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ color: '#555', fontSize: '0.7rem' }}>
              Generating <strong style={{ color: '#aaa' }}>{genCount.toLocaleString()}</strong> {genQualType} codes
              {genPromoId ? (() => { const p = promos.find((x) => x.id === genPromoId); return p ? <span> · <span style={{ color: p.color || '#F59E0B' }}>🎟 {p.name}</span>{p.endDate ? ` · expires ${p.endDate}` : ''}</span> : null; })() : <span> · no expiry</span>}
              {' '}· single-use
            </div>
            <button onClick={handleGenCodes} style={{ ...btn('linear-gradient(135deg,#00D9FF,#0099BB)', '#0a0a1a', 'transparent'), whiteSpace: 'nowrap' }}>
              Generate {genCount.toLocaleString()} Codes
            </button>
          </div>
        </div>

        {/* Code list */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          <span style={{ color: '#aaa', fontSize: '0.78rem' }}>{allCodes.length} total code{allCodes.length !== 1 ? 's' : ''} · {allCodes.filter((c) => !c.usedBy).length} unused</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select style={{ ...inp, width: 'auto', padding: '4px 8px', fontSize: '0.72rem' }} value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
              <option value="all">All codes</option>
              <option value="unused">Unused only</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Special">Special</option>
              {promos.map((p) => <option key={p.id} value={p.id}>Promo: {p.name}</option>)}
            </select>
            {displayCodes.filter((c) => !c.usedBy).length > 0 && (
              <button onClick={() => {
                const unused = displayCodes.filter((c) => !c.usedBy).map((c) => c.code).join('\n');
                writeClipboard(unused);
                setCopiedAll(true);
                setTimeout(() => setCopiedAll(false), 2000);
              }} style={btn(copiedAll ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)', copiedAll ? '#4ADE80' : '#aaa', copiedAll ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.12)')}>
                {copiedAll ? `✓ Copied ${displayCodes.filter((c) => !c.usedBy).length.toLocaleString()}` : 'Copy Unused'}
              </button>
            )}
          </div>
        </div>

        {displayCodes.length === 0 ? (
          <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: '20px 0' }}>No codes match this filter.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
            {displayCodes.map((c) => {
              const expired = new Date(c.expiresAt) < Date.now();
              const scopeLabel = c.promotionId
                ? promos.find((p) => p.id === c.promotionId)?.name || c.promotionId
                : c.qualifierType || '?';
              return (
                <div key={c.code} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: c.usedBy ? 'rgba(74,222,128,0.08)' : expired ? 'rgba(248,113,113,0.05)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${c.usedBy ? 'rgba(74,222,128,0.2)' : expired ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 6, padding: '4px 8px', fontSize: '0.75rem', fontFamily: 'monospace',
                  color: c.usedBy ? '#4ADE80' : expired ? '#F87171' : '#ccc',
                }}>
                  <span style={{ fontSize: '0.6rem', color: '#555' }}>[{scopeLabel}]</span>
                  {c.code}
                  {c.usedBy && <span style={{ fontSize: '0.62rem', color: '#4ADE80', fontFamily: 'sans-serif' }}>✓ {c.usedBy}</span>}
                  {expired && !c.usedBy && <span style={{ fontSize: '0.62rem', color: '#F87171', fontFamily: 'sans-serif' }}>exp</span>}
                  {!c.usedBy && (
                    <>
                      <button onClick={() => copyToClipboard(c.code)}
                        style={{ background: 'none', border: 'none', color: copiedCode === c.code ? '#4ADE80' : '#666', cursor: 'pointer', fontSize: '0.65rem', padding: 0 }}>
                        {copiedCode === c.code ? '✓' : '📋'}
                      </button>
                      <button onClick={() => codeActions.revoke(c.code)}
                        style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>×</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  const tabs = [
    { key: 'overview',   label: 'Overview' },
    { key: 'qualifiers', label: `Qualifiers (${qualifiers.length})` },
    { key: 'codes',      label: `Codes & Promos (${allCodes.length})` },
    { key: 'tables',     label: `Tables (${activeTables.length})` },
    { key: 'users',      label: `Users (${users.length})` },
  ];

  const panelContent = (
    <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
      <div className="admin-header">
        <div className="admin-title">Admin Dashboard</div>
        <button className="admin-close" onClick={onClose}>Close</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#8888AA' }}>Loading...</div>
      ) : !isAdmin ? (
        <div className="admin-not-auth">Access denied. Admin privileges required.</div>
      ) : (
        <>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setAdminTab(t.key)} style={tabBtn(adminTab === t.key)}>{t.label}</button>
            ))}
          </div>

          {adminTab === 'overview'    && renderOverview()}
          {adminTab === 'qualifiers'  && renderQualifiers()}
          {adminTab === 'codes'       && renderCodes()}
          {adminTab === 'tables'      && renderTables()}
          {adminTab === 'users'       && renderUsers()}
        </>
      )}
    </div>
  );

  return createPortal(
    <div className="admin-overlay" onClick={onClose}>{panelContent}</div>,
    document.body
  );
}
