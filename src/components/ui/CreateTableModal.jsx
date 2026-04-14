import { useState } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';

const VARIANTS = [
  { value: 'texas-holdem', label: "Texas Hold'em" },
  { value: 'omaha', label: 'Omaha' },
  { value: 'omaha-hi-lo', label: 'Omaha Hi-Lo' },
  { value: 'short-deck', label: 'Short Deck (6+)' },
  { value: 'five-card-draw', label: 'Five Card Draw' },
  { value: 'seven-card-stud', label: 'Seven Card Stud' },
];

const BLINDS = [
  { sb: 5, bb: 10 },
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 250, bb: 500 },
  { sb: 500, bb: 1000 },
];

export default function CreateTableModal({ onClose, playerName, avatar }) {
  const setScreen = useGameStore((s) => s.setScreen);
  const setPlayerName = useGameStore((s) => s.setPlayerName);
  const joinTable = useTableStore((s) => s.joinTable);

  const [variant, setVariant] = useState('texas-holdem');
  const [blindIdx, setBlindIdx] = useState(1);
  const [maxSeats, setMaxSeats] = useState(6);
  const [tableName, setTableName] = useState(`${playerName}'s Home Game`);
  const [straddle, setStraddle] = useState(false);
  const [bombPot, setBombPot] = useState(false);

  // Join-by-invite-code mode
  const [joinMode, setJoinMode] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [inviteCode, setInviteCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const { sb, bb } = BLINDS[blindIdx];

  function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);

    const socket = getSocket();
    if (!socket?.connected) {
      setError('Not connected to server.');
      setCreating(false);
      return;
    }

    socket.once('privateTableCreated', ({ tableId, inviteCode: code }) => {
      setInviteCode(code);
      setCreating(false);
      // Auto-join as creator (seat 0, host)
      if (playerName) setPlayerName(playerName);
      joinTable(tableId, playerName, 0, bb * 100, avatar);
      setScreen('table');
    });

    socket.emit('createPrivateTable', {
      tableName,
      variant,
      smallBlind: sb,
      bigBlind: bb,
      ante: 0,
      minBuyIn: bb * 20,
      maxSeats,
      straddle,
      bombPot,
    });
  }

  function handleJoinByCode() {
    const code = inviteInput.trim().toUpperCase();
    if (code.length < 8) { setError('Invite code must be 8 characters.'); return; }
    setError(null);

    const socket = getSocket();
    if (!socket?.connected) { setError('Not connected.'); return; }

    socket.once('joinError', ({ message }) => setError(message));
    socket.once('gameState', () => {
      if (playerName) setPlayerName(playerName);
      setScreen('table');
    });

    socket.emit('joinByInviteCode', {
      inviteCode: code,
      playerName,
      buyIn: 0,
      avatar,
    });
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1300,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(160deg, #0d0d28, #12103a)',
        border: '1px solid rgba(179,136,255,0.3)',
        borderRadius: '16px',
        width: 'min(480px, 100%)',
        padding: '24px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, color: '#E0E0E0', fontSize: '1.1rem' }}>Private Home Game</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tab: Create / Join */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {['Create Table', 'Join by Code'].map((label, i) => (
            <button key={i} onClick={() => { setJoinMode(i === 1); setError(null); }} style={{
              flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid',
              borderColor: joinMode === (i === 1) ? '#B388FF' : 'rgba(255,255,255,0.1)',
              background: joinMode === (i === 1) ? 'rgba(179,136,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: joinMode === (i === 1) ? '#B388FF' : '#8888AA',
              fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>

        {!joinMode ? (
          <>
            {/* Table Name */}
            <label style={labelStyle}>Table Name</label>
            <input value={tableName} onChange={(e) => setTableName(e.target.value)} maxLength={40} style={inputStyle} />

            {/* Variant */}
            <label style={labelStyle}>Game Type</label>
            <select value={variant} onChange={(e) => setVariant(e.target.value)} style={inputStyle}>
              {VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>

            {/* Blinds */}
            <label style={labelStyle}>Blinds</label>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
              {BLINDS.map((b, i) => (
                <button key={i} onClick={() => setBlindIdx(i)} style={{
                  padding: '6px 10px', borderRadius: '6px', border: '1px solid',
                  borderColor: blindIdx === i ? '#B388FF' : 'rgba(255,255,255,0.1)',
                  background: blindIdx === i ? 'rgba(179,136,255,0.15)' : 'rgba(255,255,255,0.04)',
                  color: blindIdx === i ? '#B388FF' : '#8888AA',
                  fontSize: '0.75rem', cursor: 'pointer',
                }}>{b.sb}/{b.bb}</button>
              ))}
            </div>

            {/* Max Seats */}
            <label style={labelStyle}>Max Seats: {maxSeats}</label>
            <input type="range" min={2} max={9} value={maxSeats} onChange={(e) => setMaxSeats(+e.target.value)}
              style={{ width: '100%', marginBottom: '12px', accentColor: '#B388FF' }} />

            {/* Options */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {[
                { label: 'Straddle', val: straddle, set: setStraddle },
                { label: 'Bomb Pot', val: bombPot, set: setBombPot },
              ].map(({ label, val, set }) => (
                <button key={label} onClick={() => set(!val)} style={{
                  padding: '6px 12px', borderRadius: '6px', border: '1px solid',
                  borderColor: val ? '#4ADE80' : 'rgba(255,255,255,0.1)',
                  background: val ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)',
                  color: val ? '#4ADE80' : '#8888AA',
                  fontSize: '0.78rem', cursor: 'pointer',
                }}>{val ? '✓ ' : ''}{label}</button>
              ))}
            </div>

            {error && <div style={{ color: '#EF4444', fontSize: '0.78rem', marginBottom: '10px' }}>{error}</div>}

            <button onClick={handleCreate} disabled={creating || !tableName.trim()} style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #B388FF, #7C3AED)',
              border: 'none', color: '#fff', fontSize: '0.95rem', fontWeight: 700,
              cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.7 : 1,
            }}>
              {creating ? 'Creating…' : 'Create & Join Table'}
            </button>
          </>
        ) : (
          <>
            <label style={labelStyle}>Invite Code (8 characters)</label>
            <input
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="e.g. A1B2C3D4"
              style={{ ...inputStyle, letterSpacing: '4px', textTransform: 'uppercase', fontWeight: 700 }}
            />
            {error && <div style={{ color: '#EF4444', fontSize: '0.78rem', marginBottom: '10px' }}>{error}</div>}
            <button onClick={handleJoinByCode} disabled={inviteInput.trim().length < 8} style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #22C55E, #4ADE80)',
              border: 'none', color: '#0a1a0a', fontSize: '0.95rem', fontWeight: 700,
              cursor: inviteInput.trim().length < 8 ? 'default' : 'pointer',
              opacity: inviteInput.trim().length < 8 ? 0.5 : 1,
            }}>
              Join Table
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const labelStyle = { display: 'block', color: '#8888AA', fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', letterSpacing: '1px', textTransform: 'uppercase' };
const inputStyle = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#E0E0E0', padding: '8px 12px', fontSize: '0.88rem', marginBottom: '12px', outline: 'none', boxSizing: 'border-box' };
