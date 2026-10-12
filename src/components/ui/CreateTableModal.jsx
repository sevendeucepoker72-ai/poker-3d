import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { reportPlayRefusal, runPlayFlow, isPlayRefusal } from '../../services/playRefusal';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import { isValidInviteCode } from '../../utils/tableList';

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

// R2 (C12) — createPrivateTable answers a refusal on 'error' with one of these
// STABLE codes (besides a C5 play refusal); the message is the server's.
// invalid_table_config: R1 AUTH-4 validation; private_table_limit / rate_limited:
// the C12 per-account caps. Any other 'error' frame is not this request's answer.
const CREATE_PRIVATE_TABLE_REFUSALS = new Set(['invalid_table_config', 'private_table_limit', 'rate_limited']);

const HOME_GAME_INVITE_HELP = 'Friends join from Play → Create / Join Private Table → Join by Code. The table closes 10 minutes after the last player leaves.';

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function CreateTableModal({ onClose, playerName, avatar }) {
  const setScreen = useGameStore((s) => s.setScreen);
  const setPlayerName = useGameStore((s) => s.setPlayerName);

  const [variant, setVariant] = useState('texas-holdem');
  const [blindIdx, setBlindIdx] = useState(1);
  const [maxSeats, setMaxSeats] = useState(6);
  const [tableName, setTableName] = useState(`${playerName}'s Home Game`);
  const [straddle, setStraddle] = useState(false);
  const [bombPot, setBombPot] = useState(false);

  // Join-by-invite-code mode
  const [joinMode, setJoinMode] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  // R2 (C12) — the created home game: { tableId, inviteCode, tableName }.
  // Shown with Copy / Share BEFORE the host sits (the code used to be stored
  // and never displayed: the modal jumped straight to the table).
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  // A join by code (the host's own seat too) in flight.
  const [joiningByCode, setJoiningByCode] = useState(false);

  const { sb, bb } = BLINDS[blindIdx];

  // Hardware back button closes the modal
  useBackButtonClose(true, onClose);

  // Track every socket listener we attach so unmounting mid-request doesn't
  // leave ghost handlers on the shared singleton socket, AND a stale response
  // doesn't fire setScreen on an unmounted component.
  const listenersRef = useRef(new Set()); // { event, fn } pairs
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const sock = getSocket();
      if (sock) {
        listenersRef.current.forEach(({ event, fn }) => sock.off(event, fn));
      }
      listenersRef.current.clear();
    };
  }, []);

  function attach(socket, event, fn) {
    listenersRef.current.add({ event, fn });
    socket.on(event, fn);
  }
  function detach(socket, event, fn) {
    for (const entry of listenersRef.current) {
      if (entry.event === event && entry.fn === fn) {
        listenersRef.current.delete(entry);
        break;
      }
    }
    socket.off(event, fn);
  }

  // `${tableId}:${seat}` when the TABLE store's gameState shows us seated, else null.
  const seatSig = (gs) =>
    (gs?.yourSeat >= 0 && gs?.seats?.[gs.yourSeat]?.playerName)
      ? `${gs.tableId ?? '?'}:${gs.yourSeat}`
      : null;

  /**
   * Emit a join and switch to the table screen ONLY once the server confirms
   * it (our fresh seat shows up in the table store). A refusal (suspended / no
   * account) or any other join error keeps the player here: refusals go to the
   * shared PlayRefusalNotice, other errors to this modal's error line.
   */
  function joinAndConfirm(socket, { errorEvent, emitJoin, expectTableId, onSeated, onFailed }) {
    const fromSig = seatSig(useTableStore.getState().gameState);
    let settled = false;
    let timeoutId = null;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      detach(socket, errorEvent, onJoinFailed);
      detach(socket, 'gameState', onGameState);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (mountedRef.current) fn();
    };
    function onJoinFailed(payload) {
      if (settled) return;
      const refused = reportPlayRefusal(payload);
      finish(() => onFailed(refused ? null : (payload?.message || 'Could not join the table.')));
    }
    function onGameState() {
      if (settled) return;
      const gs = useTableStore.getState().gameState;
      const sig = seatSig(gs);
      if (!sig || sig === fromSig) return; // not our fresh seat yet — keep waiting
      if (expectTableId && gs?.tableId && gs.tableId !== expectTableId) return;
      finish(onSeated);
    }
    attach(socket, errorEvent, onJoinFailed);
    attach(socket, 'gameState', onGameState);
    timeoutId = setTimeout(() => {
      finish(() => onFailed('Server didn\'t respond in time. Check your connection and try again.'));
    }, 10000);
    emitJoin();
  }

  function handleCreate() {
    if (creating) return;
    createTable();
  }

  // createPrivateTable is play-gated server-side and refuses on 'error'
  // {message, code}: a C5 refusal goes to the shared PlayRefusalNotice (with
  // Sign In / the silent re-auth + one replay of THIS flow for login_required
  // on a signed-in tab); a config / limit refusal (CREATE_PRIVATE_TABLE_REFUSALS)
  // ends "Creating…" with the server's sentence; a watchdog ends it if nothing
  // answers. Re-runnable for that replay.
  function createTable() {
    if (!mountedRef.current) return;
    setCreating(true);
    setError(null);

    const socket = getSocket();
    if (!socket?.connected) {
      setError('Not connected to server.');
      setCreating(false);
      return;
    }

    let settled = false;
    let timeoutId = null;
    const finish = () => {
      settled = true;
      detach(socket, 'privateTableCreated', onCreated);
      detach(socket, 'error', onCreateRefused);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    };
    function onCreated({ tableId, inviteCode: code }) {
      if (settled) return;
      finish();
      if (!mountedRef.current) return;
      setCreating(false);
      setCreated({ tableId, inviteCode: String(code || '').toUpperCase(), tableName: tableName.trim() });
    }
    function onCreateRefused(payload) {
      if (settled) return;
      if (isPlayRefusal(payload)) {
        finish();
        reportPlayRefusal(payload);
        if (mountedRef.current) setCreating(false);
        return;
      }
      const code = typeof payload?.code === 'string' ? payload.code : '';
      if (!CREATE_PRIVATE_TABLE_REFUSALS.has(code)) return;
      finish();
      if (!mountedRef.current) return;
      setCreating(false);
      setError(payload?.message || 'Could not create the table — check its settings.');
    }
    attach(socket, 'privateTableCreated', onCreated);
    attach(socket, 'error', onCreateRefused);
    timeoutId = setTimeout(() => {
      if (settled) return;
      finish();
      if (!mountedRef.current) return;
      setCreating(false);
      setError('Server didn\'t respond in time. Check your connection and try again.');
    }, 15000);

    runPlayFlow(() => createTable(), () => socket.emit('createPrivateTable', {
      tableName,
      variant,
      smallBlind: sb,
      bigBlind: bb,
      ante: 0,
      minBuyIn: bb * 20,
      maxSeats,
      straddle,
      bombPot,
    }));
  }

  function handleJoinByCode() {
    const code = inviteInput.trim().toUpperCase();
    if (!isValidInviteCode(code)) { setError('An invite code is 8 characters: the numbers 0-9 and the letters A-F.'); return; }
    joinByCode(code);
  }

  // A private table is entered ONLY through its invite code (R2 C1 / C12 —
  // poker-server refuses joinTable on a private table, the host's own too), so
  // the host takes his seat the same way his friends do. Correlates on OUR
  // fresh seat (a routine broadcast from a watched table never confirms it).
  // Re-runnable for the play-refusal replay.
  function joinByCode(code, { buyIn = 0, expectTableId = null } = {}) {
    if (!mountedRef.current) return;
    setError(null);
    const socket = getSocket();
    if (!socket?.connected) { setError('Not connected.'); return; }
    setJoiningByCode(true);
    runPlayFlow(() => joinByCode(code, { buyIn, expectTableId }), () => joinAndConfirm(socket, {
      errorEvent: 'joinError',
      expectTableId,
      emitJoin: () => socket.emit('joinByInviteCode', {
        inviteCode: code,
        playerName,
        buyIn,
        avatar,
      }),
      onSeated: () => {
        setJoiningByCode(false);
        if (playerName) setPlayerName(playerName);
        setScreen('table');
      },
      onFailed: (msg) => {
        setJoiningByCode(false);
        setError(msg);
      },
    }));
  }

  const handleCopyCode = () => {
    if (!created?.inviteCode) return;
    copyText(created.inviteCode).then((ok) => {
      if (!mountedRef.current) return;
      if (ok) { setCopied(true); setTimeout(() => { if (mountedRef.current) setCopied(false); }, 2000); }
      else setError(`Copy failed — your code is ${created.inviteCode}`);
    });
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const handleShareCode = () => {
    if (!created?.inviteCode || !canShare) return;
    navigator.share({
      title: 'American Pub Poker home game',
      text: `Join my American Pub Poker home game "${created.tableName}" with invite code ${created.inviteCode}`,
      url: 'https://americanpubpoker.online/',
    }).catch(() => { /* cancelled */ });
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1300,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={onClose}>
      <div className="create-table-modal-card" style={{
        background: 'linear-gradient(160deg, #0d1a3d, #0a1430)',
        border: '1px solid rgba(255,210,74,0.35)',
        borderRadius: '16px',
        width: 'min(480px, 100%)',
        maxHeight: '90dvh',
        overflowY: 'auto',
        padding: '20px',
        boxSizing: 'border-box',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, color: '#E0E0E0', fontSize: '1.1rem' }}>Private Home Game</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#9fb4d8', fontSize: '1.2rem', cursor: 'pointer', minWidth: 44, minHeight: 44 }}>✕</button>
        </div>

        {created ? (
          <div className="home-game-created">
            <div style={{ color: '#cfe0ff', fontSize: '0.9rem', marginBottom: 10 }}>
              <strong style={{ color: '#ffd24a' }}>{created.tableName || 'Your home game'}</strong> is ready. Share this invite code:
            </div>
            <div className="home-game-invite-code" aria-label={`Invite code ${created.inviteCode}`} style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 'clamp(1.5rem, 8vw, 2rem)', fontWeight: 800,
              letterSpacing: '0.25em', textAlign: 'center', padding: '14px 8px', borderRadius: 12, marginBottom: 10,
              background: 'rgba(255,210,74,0.08)', border: '1px dashed rgba(255,210,74,0.6)', color: '#ffd24a', userSelect: 'all',
            }}>
              {created.inviteCode}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className="home-game-copy-code" onClick={handleCopyCode} style={secondaryBtn}>{copied ? '✓ Copied' : 'Copy code'}</button>
              {canShare && <button onClick={handleShareCode} style={secondaryBtn}>Share…</button>}
            </div>
            <div style={{ color: '#9fb4d8', fontSize: '0.78rem', lineHeight: 1.45, marginBottom: 14 }}>{HOME_GAME_INVITE_HELP}</div>
            {error && <div className="create-table-error" role="alert" style={errorStyle}>{error}</div>}
            <button
              onClick={() => joinByCode(created.inviteCode, { buyIn: bb * 100, expectTableId: created.tableId })}
              disabled={joiningByCode}
              style={{ ...primaryBtn, opacity: joiningByCode ? 0.7 : 1, cursor: joiningByCode ? 'default' : 'pointer' }}
            >
              {joiningByCode ? 'Taking your seat…' : 'Take your seat'}
            </button>
          </div>
        ) : (
          <>
            {/* Tab: Create / Join */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {['Create Table', 'Join by Code'].map((label, i) => (
                <button key={i} onClick={() => { setJoinMode(i === 1); setError(null); }} style={{
                  flex: 1, padding: '10px 8px', minHeight: 44, borderRadius: '8px', border: '1px solid',
                  borderColor: joinMode === (i === 1) ? '#ffd24a' : 'rgba(255,255,255,0.1)',
                  background: joinMode === (i === 1) ? 'rgba(255,210,74,0.12)' : 'rgba(255,255,255,0.04)',
                  color: joinMode === (i === 1) ? '#ffd24a' : '#9fb4d8',
                  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                }}>{label}</button>
              ))}
            </div>

            {!joinMode ? (
              <>
                <label style={labelStyle}>Table Name</label>
                <input value={tableName} onChange={(e) => setTableName(e.target.value)} maxLength={40} style={inputStyle} />

                <label style={labelStyle}>Game Type</label>
                <select value={variant} onChange={(e) => setVariant(e.target.value)} style={inputStyle}>
                  {VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>

                <label style={labelStyle}>Blinds</label>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  {BLINDS.map((b, i) => (
                    <button key={i} onClick={() => setBlindIdx(i)} style={{
                      padding: '8px 10px', minHeight: 38, borderRadius: '6px', border: '1px solid',
                      borderColor: blindIdx === i ? '#ffd24a' : 'rgba(255,255,255,0.1)',
                      background: blindIdx === i ? 'rgba(255,210,74,0.12)' : 'rgba(255,255,255,0.04)',
                      color: blindIdx === i ? '#ffd24a' : '#9fb4d8',
                      fontSize: '0.78rem', cursor: 'pointer',
                    }}>{b.sb}/{b.bb}</button>
                  ))}
                </div>

                {/* Max Seats — honoured by the server (R2 C12): no seat beyond it can be taken. */}
                <label style={labelStyle}>Max Seats: {maxSeats}</label>
                <input type="range" min={2} max={9} value={maxSeats} onChange={(e) => setMaxSeats(+e.target.value)}
                  style={{ width: '100%', marginBottom: '12px', accentColor: '#ffd24a' }} />

                {/* Straddle is not implemented server-side (the create handler
                    drops the flag), so it is disabled + marked "soon". */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[
                    { label: 'Straddle', val: straddle, set: setStraddle, disabled: true },
                    { label: 'Bomb Pot', val: bombPot, set: setBombPot },
                  ].map(({ label, val, set, disabled }) => (
                    <button key={label} disabled={disabled} onClick={() => { if (!disabled) set(!val); }}
                      title={disabled ? 'Straddle isn’t available yet' : undefined}
                      style={{
                        padding: '8px 12px', minHeight: 38, borderRadius: '6px', border: '1px solid',
                        borderColor: val ? '#ffd24a' : 'rgba(255,255,255,0.1)',
                        background: val ? 'rgba(255,210,74,0.12)' : 'rgba(255,255,255,0.04)',
                        color: val ? '#ffd24a' : '#9fb4d8',
                        fontSize: '0.78rem', cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.5 : 1,
                      }}>{val ? '✓ ' : ''}{label}{disabled ? ' (soon)' : ''}</button>
                  ))}
                </div>

                {error && <div className="create-table-error" role="alert" style={errorStyle}>{error}</div>}

                <button onClick={handleCreate} disabled={creating || !tableName.trim()} style={{ ...primaryBtn, cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.7 : 1 }}>
                  {creating ? 'Creating…' : 'Create Home Game'}
                </button>
              </>
            ) : (
              <>
                <label style={labelStyle}>Invite Code (8 characters)</label>
                <input
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleJoinByCode(); }}
                  maxLength={8}
                  placeholder="e.g. A1B2C3D4"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{ ...inputStyle, letterSpacing: '4px', textTransform: 'uppercase', fontWeight: 700 }}
                />
                {error && <div className="create-table-error" role="alert" style={errorStyle}>{error}</div>}
                <button onClick={handleJoinByCode} disabled={inviteInput.trim().length < 8 || joiningByCode} style={{
                  ...primaryBtn,
                  cursor: inviteInput.trim().length < 8 || joiningByCode ? 'default' : 'pointer',
                  opacity: inviteInput.trim().length < 8 ? 0.5 : (joiningByCode ? 0.7 : 1),
                }}>
                  {joiningByCode ? 'Joining…' : 'Join Table'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// Join / create errors in blue + gold, not red (owner preference).
const errorStyle = { color: '#ffd24a', background: 'rgba(12,28,72,0.85)', border: '1px solid rgba(255,210,74,0.45)', borderRadius: '8px', padding: '8px 10px', fontSize: '0.78rem', lineHeight: 1.4, marginBottom: '10px' };
const labelStyle = { display: 'block', color: '#9fb4d8', fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', letterSpacing: '1px', textTransform: 'uppercase' };
const inputStyle = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#E0E0E0', padding: '10px 12px', fontSize: '16px', marginBottom: '12px', outline: 'none', boxSizing: 'border-box' };
const primaryBtn = { width: '100%', minHeight: 46, padding: '12px', borderRadius: '10px', background: 'linear-gradient(135deg, #ffd24a, #e6b422)', border: 'none', color: '#0a1628', fontSize: '0.95rem', fontWeight: 800 };
const secondaryBtn = { flex: 1, minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid rgba(120,160,255,0.5)', background: 'rgba(106,186,255,0.1)', color: '#cfe0ff', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer' };
