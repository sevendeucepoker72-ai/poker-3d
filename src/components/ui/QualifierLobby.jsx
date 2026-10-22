import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
// 2026-10-20 — a registered player's way back to his seat in a running qualifier.
import { awaySeatOfTournament, noteTournamentSeat } from '../../store/tournamentSeatStore';
import { clearTableLeft } from '../../services/leftTables';
import { qualifierRunningActions } from '../../utils/tableFlows';
import { returnToTournament } from '../../services/tournamentReturn';
import { reportPlayRefusal, runPlayFlow, GAME_SERVER_UNREACHABLE_TEXT } from '../../services/playRefusal';
import {
  normalizeQualifierList, qualifierSignupState, qualifierStatusCounts,
  qualifierResultText, seatsForTopText,
  featuredQualifier, qualifierHomeStatus, formatDenverWhen,
  qualifierCreditsHeld, qualifierIsQualified, qualifierReentriesAvailable, qualifierHomeYouText,
} from '../../utils/qualifierList';
import { useProgressStore } from '../../store/progressStore';
import QualifierDashboard from './QualifierDashboard';

// A first entry waits on the master API's credit consume (awaited server-side),
// so allow longer than a table join before calling the server unreachable.
const REGISTER_WATCHDOG_MS = 20000;
// An older server has no per-player `registered` flag: this tab remembers its
// own registration answers (per account), never a match on a player's name.
const LOCAL_REG_KEY = 'poker_qual_reg_v1';

export const QUALIFIER_NO_LIST_TEXT = 'No qualifier tournaments are scheduled right now.';

function readLocalRegs(owner) {
  try {
    const raw = sessionStorage.getItem(LOCAL_REG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && owner && parsed.owner === owner && Array.isArray(parsed.ids)) return new Set(parsed.ids.map(String));
  } catch { /* ignore */ }
  return new Set();
}
function writeLocalRegs(owner, ids) {
  try {
    if (!owner) return;
    sessionStorage.setItem(LOCAL_REG_KEY, JSON.stringify({ owner, ids: [...ids] }));
  } catch { /* ignore */ }
}

function formatCountdown(target, now = Date.now()) {
  if (target == null) return '';
  const diff = target - now;
  if (diff <= 0) return 'now';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

function formatWhen(t) {
  if (t == null) return '';
  try {
    return new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return new Date(t).toISOString(); }
}

const TYPE_ICONS = { weekly: '🗓️', monthly: '🏆' };
const TYPE_COLORS = { weekly: '#ffd24a', monthly: '#9db8ff' };

const box = (extra = {}) => ({
  padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem', textAlign: 'center', lineHeight: 1.45, ...extra,
});

export const QUALIFIER_WAITING_FOR_PLAYERS_TEXT = 'You have a seat at a new table. The first hand is dealt as soon as another player joins it.';

/**
 * variant 'home' (owner 2026-10-22: "the qualifier should be at the top of the
 * home page at .online") — ONE card, the next / current qualifier
 * (`featuredQualifier`), at the top of the lobby's home tab; nothing at all
 * while there is none. Same data, actions and registration flow as the Play
 * tab's full list (only one of the two is mounted at a time).
 */
export default function QualifierLobby({ onSpectate, variant, onSeeAll }) {
  const home = variant === 'home';
  const playerName = useGameStore((s) => s.playerName);
  const userId = useGameStore((s) => s.userId);
  const owner = userId != null ? String(userId) : null;

  const [list, setList] = useState([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [qualStatus, setQualStatus] = useState({ weekly: false, monthly: false });
  const [qualLoaded, setQualLoaded] = useState(false);
  const [localRegs, setLocalRegs] = useState(() => readLocalRegs(owner));
  const [openDashboard, setOpenDashboard] = useState(null); // qualifierId or null
  const [now, setNow] = useState(() => Date.now());
  const [redeemCode, setRedeemCode] = useState('');        // Batch 5b: entry-code redemption
  const [redeemMsg, setRedeemMsg] = useState(null);        // { ok, text }
  const [redeeming, setRedeeming] = useState(false);
  // The qualifier whose Register / Withdraw awaits an answer, and the last
  // non-refusal failure, shown verbatim. Refusals (suspended / no account) go
  // to the shared PlayRefusalNotice instead.
  const [pendingReg, setPendingReg] = useState(null); // { id, kind }
  const [regMsg, setRegMsg] = useState(null);

  // Another account on this tab: its own (empty) local registrations.
  useEffect(() => { setLocalRegs(readLocalRegs(owner)); }, [owner]);
  // Countdowns / window states move with time.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const noteLocalReg = useCallback((qualifierId, on) => {
    setLocalRegs((prev) => {
      const next = new Set(prev);
      if (on) next.add(String(qualifierId)); else next.delete(String(qualifierId));
      writeLocalRegs(owner, next);
      return next;
    });
  }, [owner]);

  // Batch 5b: listen for the entry-code redemption result.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onResult = (res) => {
      setRedeeming(false);
      // A C5 play refusal goes to the shared PlayRefusalNotice; the code stays
      // in the box (the gate runs before the code is claimed).
      if (reportPlayRefusal(res)) { setRedeemMsg(null); return; }
      if (res?.success) {
        setRedeemMsg({ ok: true, text: `Code redeemed — ${res.tier || 'weekly'} qualifier credit added!` });
        setRedeemCode('');
        socket.emit('getQualifications'); // refresh qualification status
      } else {
        setRedeemMsg({ ok: false, text: res?.error || 'Could not redeem code' });
      }
      setTimeout(() => setRedeemMsg(null), 4000);
    };
    socket.on('redeemEntryCodeResult', onResult);
    return () => socket.off('redeemEntryCodeResult', onResult);
  }, []);

  // Qualification status + the server's qualifier list.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) { setQualLoaded(true); return undefined; }
    // AUTH-9 — identity is the signed-in account (server side): no phone, no name.
    socket.emit('getQualifications');
    socket.emit('getQualifierTournaments');
    const loadingTimeout = setTimeout(() => { setQualLoaded(true); setListLoaded(true); }, 8000);

    const qualHandler = (data) => {
      setQualStatus(data && typeof data === 'object' ? data : { weekly: false, monthly: false });
      setQualLoaded(true);
    };
    const updateHandler = (data) => {
      // An older server's delta: status / count only (its player names are not used).
      if (!data?.qualifierId) return;
      setList((prev) => prev.map((q) => (q.qualifierId !== String(data.qualifierId) ? q : {
        ...q,
        status: ['scheduled', 'registering', 'running', 'finished'].includes(data.status) ? data.status : q.status,
        cancelled: data.cancelled === true ? true : q.cancelled,
        players: Number.isFinite(Number(data.registeredCount)) ? Number(data.registeredCount)
          : (typeof data.players === 'number' ? data.players : q.players),
      })));
    };
    const startHandler = (data) => {
      if (!data?.qualifierId) return;
      setList((prev) => prev.map((q) => (q.qualifierId !== String(data.qualifierId) ? q
        : { ...q, status: 'running', tournamentId: data.tournamentId != null ? String(data.tournamentId) : q.tournamentId })));
    };
    const regResultHandler = (data) => {
      setPendingReg(null);
      // 2026-10-22 — every entry and re-entry uses one credit (a refusal
      // refunds it): read his credits again after every answer, so Register /
      // Re-enter and "N left" follow what he holds now.
      try { socket.emit('getQualifications'); } catch { /* next mount */ }
      if (data?.success) {
        setRegMsg(null);
        if (data.qualifierId) noteLocalReg(data.qualifierId, !data.unregistered);
        // A newer server may seat a late entry / re-entry alone at a new table.
        if (data.waitingForPlayers === true) {
          try { useProgressStore.getState().addNotification({ type: 'mission', title: 'Qualifier seat', message: QUALIFIER_WAITING_FOR_PLAYERS_TEXT }); } catch { /* best-effort */ }
        }
        // Gameplay audit F142 (2026-10-21) — a RE-ENTRY seated him at once
        // (a fresh stack, blinds running): take him to that table. A newer
        // server also sends qualifierTournamentStarted (App does the same;
        // doing it twice is harmless); an older one sends only this.
        if (data.reentry === true && data.tableId != null) {
          try { noteTournamentSeat({ tournamentId: data.tournamentId, tableId: data.tableId, name: 'Qualifier Tournament' }); } catch { /* best-effort */ }
          try { clearTableLeft(data.tableId); } catch { /* ignore */ }
          try { useGameStore.getState().setScreen('table'); } catch { /* ignore */ }
        }
        // The server's own flag + count, at once.
        try { socket.emit('getQualifierTournaments'); } catch { /* next poll */ }
        return;
      }
      if (reportPlayRefusal(data)) { setRegMsg(null); return; }
      setRegMsg(data?.error || data?.message || 'Registration failed — please try again.');
    };

    // Adaptive polling with exponential backoff (10s, doubling to 2 min while
    // no list arrives; back to 10s on every list).
    const BASE_MS = 10000;
    const MAX_MS = 120000;
    let currentDelay = BASE_MS;
    let lastListAt = Date.now();
    let pollTimer = null;
    const listHandler = (raw) => {
      currentDelay = BASE_MS;
      lastListAt = Date.now();
      setList(normalizeQualifierList(raw));
      setListLoaded(true);
    };
    const scheduleNextPoll = () => {
      pollTimer = setTimeout(() => {
        if (Date.now() - lastListAt > currentDelay * 2) currentDelay = Math.min(MAX_MS, currentDelay * 2);
        socket.emit('getQualifierTournaments');
        scheduleNextPoll();
      }, currentDelay);
    };
    scheduleNextPoll();

    socket.on('qualifications', qualHandler);
    socket.on('qualifierTournamentList', listHandler);
    socket.on('qualifierTournamentUpdate', updateHandler);
    socket.on('qualifierRegistrationResult', regResultHandler);
    socket.on('qualifierTournamentStarted', startHandler);
    return () => {
      socket.off('qualifications', qualHandler);
      socket.off('qualifierTournamentList', listHandler);
      socket.off('qualifierTournamentUpdate', updateHandler);
      socket.off('qualifierRegistrationResult', regResultHandler);
      socket.off('qualifierTournamentStarted', startHandler);
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(loadingTimeout);
    };
  }, [noteLocalReg]);

  // While a Register / Withdraw is in flight: some refusals arrive on the
  // shared 'error' event instead of qualifierRegistrationResult, so listen for
  // it during that window only, and give up after REGISTER_WATCHDOG_MS.
  useEffect(() => {
    if (!pendingReg) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const onServerError = (err) => {
      setPendingReg(null);
      if (reportPlayRefusal(err)) { setRegMsg(null); return; }
      setRegMsg(err?.message || 'Registration failed — please try again.');
    };
    socket.on('error', onServerError);
    const watchdog = setTimeout(() => {
      setPendingReg(null);
      // A withdraw the server ignored (an older server answers some branches
      // with nothing) is not proof it is unreachable: ask for the list again.
      if (pendingReg.kind === 'withdraw') { try { socket.emit('getQualifierTournaments'); } catch { /* ignore */ } return; }
      setRegMsg(GAME_SERVER_UNREACHABLE_TEXT);
    }, REGISTER_WATCHDOG_MS);
    return () => {
      socket.off('error', onServerError);
      clearTimeout(watchdog);
    };
  }, [pendingReg]);

  // Play-refusal replay (services/playRefusal.js): a login_required on a
  // still-signed-in tab re-authenticates the socket and runs this registration
  // again ONCE through the latest handleRegister, unless the lobby unmounted.
  const handleRegisterRef = useRef(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const handleRegister = useCallback((q) => {
    const socket = getSocket();
    if (!socket) return;
    setRegMsg(null);
    setPendingReg({ id: q.qualifierId, kind: 'register' });
    runPlayFlow(() => {
      if (mountedRef.current && handleRegisterRef.current) handleRegisterRef.current(q);
    }, () => socket.emit('registerQualifierTournament', { qualifierId: q.qualifierId, playerName }));
  }, [playerName]);
  useEffect(() => { handleRegisterRef.current = handleRegister; }, [handleRegister]);

  // Batch 5b: redeem an entry code (re-runnable for the play-refusal replay).
  const sendRedeem = useCallback(function sendRedeemOnce(code) {
    if (!mountedRef.current) return;
    const socket = getSocket();
    if (!socket) return;
    setRedeemMsg(null);
    setRedeeming(true);
    runPlayFlow(() => sendRedeemOnce(code), () => socket.emit('redeemEntryCode', { code }));
  }, []);
  const handleRedeem = () => {
    const code = redeemCode.trim().toUpperCase();
    if (!code || redeeming) return;
    sendRedeem(code);
  };

  const handleUnregister = useCallback((q) => {
    const socket = getSocket();
    if (!socket) return;
    setRegMsg(null);
    setPendingReg({ id: q.qualifierId, kind: 'withdraw' });
    socket.emit('unregisterQualifierTournament', { qualifierId: q.qualifierId });
  }, []);

  const handleSpectate = useCallback((tournamentId) => {
    const socket = getSocket();
    if (!socket || !tournamentId) return;
    socket.emit('spectateTournament', { tournamentId });
    if (onSpectate) onSpectate();
  }, [onSpectate]);

  // 2026-10-20 — "Go to my table": a REGISTERED player in a running
  // qualifier is taken back to his own seat (it was "Watch Live", which made
  // him a spectator of his own event — the server now refuses that). An away
  // seat this tab knows goes through the usual Return (services/tournamentReturn);
  // otherwise (a reload / another device) the server finds his absent seat by
  // account (`returnToTournamentSeat` {tournamentId}); its 'reconnectedToTable'
  // opens the table, and a refusal is shown here.
  const handleGoToMyTable = useCallback((q) => {
    setRegMsg(null);
    const away = awaySeatOfTournament(q.tournamentId);
    if (away) { returnToTournament(away.key).catch(() => { /* answered in the store */ }); return; }
    const socket = getSocket();
    if (!socket || !socket.connected) { setRegMsg(GAME_SERVER_UNREACHABLE_TEXT); return; }
    socket.emit('returnToTournamentSeat', { tournamentId: q.tournamentId }, (r) => {
      if (r && r.success === false) {
        if (reportPlayRefusal(r)) return;
        setRegMsg(r.error || 'We could not find your seat in this qualifier.');
      }
    });
  }, []);

  const isRegistered = useCallback((q) => (q.registered !== null ? q.registered : localRegs.has(q.qualifierId)), [localRegs]);
  const counts = useMemo(() => qualifierStatusCounts(list, now), [list, now]);
  const featured = useMemo(() => (home ? featuredQualifier(list, now) : null), [home, list, now]);

  if (list.length === 0) {
    // The home page shows nothing until there is a qualifier to show.
    if (home) return null;
    if (!listLoaded) {
      return (
        <div style={{ color: '#8298c4', fontSize: '0.85rem', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#ffd24a33', border: '1px solid #ffd24a', animation: 'pulse 1.2s infinite' }} />
          Checking available qualifiers…
        </div>
      );
    }
    return <div className="qualifier-empty" style={{ color: '#8298c4', fontSize: '0.85rem', padding: '12px 0' }}>{QUALIFIER_NO_LIST_TEXT}</div>;
  }

  const renderAction = (q, compact = false) => {
    const state = qualifierSignupState(q, now);
    const qs = qualStatus?.[q.type];
    // 2026-10-22 — a newer server's per-viewer `creditsHeld` first (fresh with
    // every list), else the 'qualifications' answer, as before.
    const qualified = qualifierIsQualified(q, qs);
    const mine = isRegistered(q);
    const pend = pendingReg && pendingReg.id === q.qualifierId ? pendingReg.kind : null;
    const pad = compact ? '10px 14px' : '12px 18px';
    if (!qualLoaded) return <div style={{ color: '#8298c4', fontSize: '0.8rem', padding: '10px 0' }}>Checking qualification…</div>;
    if (state === 'finished' && q.cancelled) {
      // R2 review (K3-5) — a cancelled event never says "completed".
      // R3 (contract Q1) — no reason here: a game-server restart cancels with
      // the same update as too few players (the toast says which).
      return (
        <div className="qualifier-result-line" style={box({ background: 'rgba(130,152,196,0.08)', border: '1px solid rgba(130,152,196,0.25)', color: '#cfe0ff' })}>
          Cancelled. Any qualifier credit it used was refunded.
        </div>
      );
    }
    if (state === 'finished') {
      const line = qualifierResultText(q.result);
      return (
        <div className="qualifier-result-line" style={box({ background: 'rgba(130,152,196,0.08)', border: '1px solid rgba(130,152,196,0.25)', color: line ? (q.result?.wonSeat ? '#ffd24a' : '#cfe0ff') : '#9fb4d8' })}>
          {line || 'Tournament completed'}
        </div>
      );
    }
    if (state === 'running' || state === 'late') {
      // Gameplay audit F142 (2026-10-21) — a registrant whose entry is OUT
      // (the server's per-viewer `eliminated`) gets Re-enter during late
      // registration (a credit + re-entries left), else a plain "out" line —
      // never "Go to my table", which the server refuses for a busted entry.
      // `eliminated` absent (an older server): as before.
      // 2026-10-22 (owner: "re entries if they have more credits") — the
      // re-entries he can make: the server's count, never more than the
      // credits he holds (each re-entry uses one).
      const reEntriesLeft = qualifierReentriesAvailable(q, qualLoaded ? qualifierCreditsHeld(q, qs) : null);
      const acts = qualifierRunningActions({
        state, mine, eliminated: q.eliminated, qualified, reEntriesLeft, tournamentId: q.tournamentId,
      });
      const canLate = acts.lateRegister;
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {acts.reenter && (
            <button className="qualifier-reenter" onClick={(e) => { e.stopPropagation(); handleRegister(q); }} disabled={!!pend} style={{ flex: 1, minWidth: 140, padding: pad, borderRadius: 8, fontWeight: 800, fontSize: '0.88rem', background: 'linear-gradient(135deg,#ffd24a,#e6b422)', color: '#0a1628', border: 'none', cursor: pend ? 'default' : 'pointer', opacity: pend ? 0.7 : 1 }}>
              {pend === 'register' ? 'Registering…' : 'Re-enter (uses 1 credit)'}
            </button>
          )}
          {acts.outLine && (
            <div className="qualifier-out-line" style={box({ flex: 1, background: 'rgba(106,186,255,0.08)', border: '1px solid rgba(106,186,255,0.25)', color: '#cfe0ff' })}>
              You are out of this qualifier.
            </div>
          )}
          {canLate && (
            <button onClick={(e) => { e.stopPropagation(); handleRegister(q); }} disabled={!!pend} style={{ flex: 1, minWidth: 140, padding: pad, borderRadius: 8, fontWeight: 700, fontSize: '0.88rem', background: 'linear-gradient(135deg,#ffd24a,#e6b422)', color: '#0a1628', border: 'none', cursor: pend ? 'default' : 'pointer', opacity: pend ? 0.7 : 1 }}>
              {pend === 'register' ? 'Registering…' : 'Late Register (uses 1 credit)'}
            </button>
          )}
          {acts.goToTable && (
            <button className="qualifier-go-to-my-table" onClick={(e) => { e.stopPropagation(); handleGoToMyTable(q); }} style={{ flex: 1, minWidth: 140, padding: pad, borderRadius: 8, fontWeight: 800, fontSize: '0.88rem', background: 'linear-gradient(135deg,#ffd24a,#e6b422)', color: '#0a1628', border: 'none', cursor: 'pointer' }}>
              ↩ Go to my table
            </button>
          )}
          {acts.watch && (
            <button onClick={(e) => { e.stopPropagation(); handleSpectate(q.tournamentId); }} style={{ flex: 1, minWidth: 120, padding: pad, borderRadius: 8, fontWeight: 700, fontSize: '0.88rem', background: 'rgba(106,186,255,0.14)', color: '#cfe0ff', border: '1px solid rgba(106,186,255,0.5)', cursor: 'pointer' }}>
              Watch Live
            </button>
          )}
          {!canLate && !acts.reenter && !acts.outLine && !q.tournamentId && (
            <div style={box({ flex: 1, background: 'rgba(106,186,255,0.08)', border: '1px solid rgba(106,186,255,0.25)', color: '#cfe0ff' })}>In progress</div>
          )}
        </div>
      );
    }
    if (mine) {
      const canWithdraw = state === 'open' || state === 'scheduled';
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={box({ flex: 1, background: 'rgba(255,210,74,0.1)', border: '1px solid rgba(255,210,74,0.35)', color: '#ffd24a', fontWeight: 700 })}>✓ Registered</div>
          {canWithdraw && (
            <button onClick={(e) => { e.stopPropagation(); handleUnregister(q); }} disabled={!!pend} style={{ padding: '10px 14px', borderRadius: 8, fontSize: '0.8rem', background: 'transparent', border: '1px solid rgba(120,160,255,0.5)', color: '#cfe0ff', cursor: pend ? 'default' : 'pointer', opacity: pend ? 0.6 : 1 }}>
              {pend === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
        </div>
      );
    }
    if (state === 'open') {
      if (qualified) {
        return (
          <button onClick={(e) => { e.stopPropagation(); handleRegister(q); }} disabled={!!pend} style={{ width: '100%', padding: pad, borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', background: 'linear-gradient(135deg,#ffd24a,#e6b422)', color: '#0a1628', border: 'none', cursor: pend ? 'default' : 'pointer', opacity: pend ? 0.7 : 1 }}>
            {pend === 'register' ? 'Registering…' : "Register — You're Qualified!"}
          </button>
        );
      }
      return (
        <div style={box({ background: 'rgba(12,28,72,0.6)', border: '1px solid rgba(255,210,74,0.25)', color: '#cfe0ff' })}>
          {q.type === 'monthly'
            ? 'Not yet qualified — qualify via a Weekly, league standings, or attendance (see above)'
            : 'Not yet qualified — finish top 5 in any live game to earn entry'}
        </div>
      );
    }
    if (state === 'scheduled') {
      return (
        <div style={box({ background: 'rgba(255,210,74,0.06)', border: '1px solid rgba(255,210,74,0.25)', color: '#ffd24a' })}>
          {q.signupOpensAt != null ? `Signup opens in ${formatCountdown(q.signupOpensAt, now)} — ${formatWhen(q.signupOpensAt)}` : 'Signup has not opened yet'}
          {qualified ? ' · you are qualified' : ''}
        </div>
      );
    }
    if (state === 'closed') return <div style={box({ background: 'rgba(130,152,196,0.08)', border: '1px solid rgba(130,152,196,0.2)', color: '#9fb4d8' })}>Signup window has closed</div>;
    return <div style={box({ background: 'rgba(130,152,196,0.08)', border: '1px solid rgba(130,152,196,0.2)', color: '#9fb4d8' })}>Signup times have not been announced yet</div>;
  };

  // Registration failure, verbatim. Fixed + above the QualifierDashboard
  // modal (zIndex 1000). Blue + gold, not red.
  const regMsgNode = regMsg ? (
    <div
      className="qualifier-register-msg"
      role="alert"
      onClick={() => setRegMsg(null)}
      style={{
        position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
        zIndex: 3100, width: 'min(92vw, 360px)', boxSizing: 'border-box',
        padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
        background: 'linear-gradient(135deg, rgba(12,28,72,0.97), rgba(8,18,48,0.97))',
        border: '1px solid rgba(255,210,74,0.55)', color: '#ffd24a',
        fontSize: 13, fontWeight: 600, lineHeight: 1.4, textAlign: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      {regMsg} <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 6 }}>(tap to dismiss)</span>
    </div>
  ) : null;

  // Dashboard modal
  const dashboardNode = (() => {
    if (!openDashboard) return null;
    const q = list.find((x) => x.qualifierId === openDashboard);
    if (!q) return null;
    const qs = qualStatus?.[q.type];
    return (
      <QualifierDashboard
        qualifier={q}
        now={now}
        isRegistered={isRegistered(q)}
        isQualified={qualifierIsQualified(q, qs)}
        action={renderAction(q, true)}
        onClose={() => setOpenDashboard(null)}
      />
    );
  })();

  if (home) {
    // 2026-10-22 (owner) — the home page's qualifier card: one event, its
    // start in Denver time, its seat package, where it stands (late entry
    // until the server's lateRegUntil) and his own credits / re-entries.
    const q = featured;
    if (!q) return null;
    const state = qualifierSignupState(q, now);
    const live = state === 'running' || state === 'late';
    const color = TYPE_COLORS[q.type] || '#ffd24a';
    const status = qualifierHomeStatus(q, now);
    const seatsLine = seatsForTopText(q.seatsForTop, q.seatPackage);
    const qs = qualStatus?.[q.type];
    const credits = qualLoaded ? qualifierCreditsHeld(q, qs) : (Number.isInteger(q.creditsHeld) ? q.creditsHeld : null);
    const youText = qualLoaded ? qualifierHomeYouText(q, {
      state, registered: isRegistered(q), credits,
      reentries: qualifierReentriesAvailable(q, credits), qualified: qualifierIsQualified(q, qs),
    }) : null;
    const eyebrow = live ? 'Qualifier live now' : (state === 'finished' ? 'Latest qualifier' : 'Next online qualifier');
    return (
      <>
        {regMsgNode}
        <div className="home-qualifier-card" onClick={() => setOpenDashboard(q.qualifierId)} style={{
          background: 'linear-gradient(135deg, rgba(12,28,72,0.96), rgba(20,30,70,0.78))',
          border: `1px solid ${live ? 'rgba(106,186,255,0.6)' : 'rgba(255,210,74,0.45)'}`,
          borderRadius: 14, padding: '14px', marginBottom: 14, cursor: 'pointer', minWidth: 0,
          boxSizing: 'border-box', boxShadow: '0 6px 22px rgba(0,0,0,0.35)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: live ? '#6abaff' : '#ffd24a' }}>{eyebrow}</span>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}55`, textTransform: 'uppercase', flexShrink: 0 }}>{q.typeLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>{TYPE_ICONS[q.type] || '🏆'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#fff', overflowWrap: 'anywhere' }}>{q.name}</div>
              <div style={{ color: '#cfe0ff', fontSize: '0.8rem', marginTop: 2 }}>
                {q.scheduledAt != null ? formatDenverWhen(q.scheduledAt) : 'Start time not announced yet'}
              </div>
            </div>
            {!live && state !== 'finished' && q.scheduledAt != null && q.scheduledAt > now && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ color, fontWeight: 800, fontSize: '0.9rem' }}>{formatCountdown(q.scheduledAt, now)}</div>
                <div style={{ color: '#8298c4', fontSize: '0.66rem' }}>until start</div>
              </div>
            )}
          </div>
          <div className="home-qualifier-status" style={{ marginTop: 8, fontSize: '0.82rem', fontWeight: 700, color: live ? '#6abaff' : (state === 'finished' || state === 'closed' ? '#9fb4d8' : '#ffd24a') }}>
            ⏱ {status.text}
          </div>
          {seatsLine && (
            <div style={{ marginTop: 4, fontSize: '0.78rem', color: '#ffd24a', lineHeight: 1.4 }}>🎟 {seatsLine}</div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, fontSize: '0.76rem', color: '#9fb4d8' }}>
            <span>👥 <strong style={{ color: '#fff' }}>{q.players}{q.maxPlayers ? `/${q.maxPlayers}` : ''}</strong> registered</span>
            {youText && <span className="home-qualifier-you" style={{ color: '#cfe0ff', fontWeight: 600 }}>{youText}</span>}
          </div>
          <div style={{ marginTop: 10 }}>{renderAction(q, true)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#8298c4', fontSize: '0.7rem' }}>Tap for details</span>
            {onSeeAll && (
              <button className="home-qualifier-all" onClick={(e) => { e.stopPropagation(); onSeeAll(); }} style={{ background: 'transparent', border: 'none', color: '#6abaff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', padding: '6px 0', minHeight: 32 }}>
                All qualifiers →
              </button>
            )}
          </div>
        </div>
        {dashboardNode}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {regMsgNode}

      <div className="qualifier-status-counts" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.75rem', color: '#9fb4d8' }}>
        <span>{counts.upcoming} upcoming</span>
        <span>·</span>
        <span style={{ color: counts.live ? '#6abaff' : '#9fb4d8' }}>{counts.live} live</span>
        {counts.finished > 0 && <><span>·</span><span>{counts.finished} finished</span></>}
      </div>

      {/* Batch 5b: redeem a promo entry code for a qualifier credit. */}
      <div style={{ background: 'linear-gradient(135deg, rgba(10,10,20,0.9), rgba(20,30,70,0.6))', border: '1px solid rgba(255,210,74,0.25)', borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRedeem(); }}
            placeholder="Enter entry code"
            maxLength={8}
            style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, fontSize: '0.85rem', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', outline: 'none' }}
          />
          <button onClick={handleRedeem} disabled={redeeming || !redeemCode.trim()} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap',
            border: 'none', cursor: redeeming || !redeemCode.trim() ? 'default' : 'pointer',
            background: redeeming || !redeemCode.trim() ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg,#ffd24a,#e6b422)',
            color: redeeming || !redeemCode.trim() ? '#8298c4' : '#0a1628',
          }}>{redeeming ? 'Redeeming…' : 'Redeem'}</button>
        </div>
        {redeemMsg && (
          <div style={{ marginTop: 8, fontSize: '0.78rem', fontWeight: 600, color: redeemMsg.ok ? '#ffd24a' : '#cfe0ff' }}>
            {redeemMsg.text}
          </div>
        )}
      </div>

      {list.map((q) => {
        const color = TYPE_COLORS[q.type] || '#ffd24a';
        const state = qualifierSignupState(q, now);
        const live = state === 'running' || state === 'late';
        const qs = qualStatus?.[q.type];
        const seatsLine = seatsForTopText(q.seatsForTop, q.seatPackage);
        return (
          <div key={q.qualifierId} className="qualifier-card" onClick={() => setOpenDashboard(q.qualifierId)} style={{
            background: 'linear-gradient(135deg, rgba(10,10,20,0.95), rgba(20,30,70,0.7))',
            border: `1px solid ${live ? 'rgba(106,186,255,0.45)' : color + '33'}`,
            borderRadius: 14, padding: '16px', cursor: 'pointer', minWidth: 0,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>{TYPE_ICONS[q.type] || '🏆'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.98rem', color: '#fff' }}>{q.name}</span>
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}55`, textTransform: 'uppercase' }}>{q.typeLabel}</span>
                  {live && <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(106,186,255,0.15)', color: '#6abaff', border: '1px solid rgba(106,186,255,0.4)', textTransform: 'uppercase' }}>Live</span>}
                </div>
                <div style={{ color: '#9fb4d8', fontSize: '0.76rem', marginTop: 2 }}>
                  {q.scheduledAt != null ? formatWhen(q.scheduledAt) : 'Start time not announced yet'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {!live && state !== 'finished' && q.scheduledAt != null && q.scheduledAt > now && (
                  <>
                    <div style={{ color, fontWeight: 700, fontSize: '0.85rem' }}>{formatCountdown(q.scheduledAt, now)}</div>
                    <div style={{ color: '#8298c4', fontSize: '0.68rem' }}>until start</div>
                  </>
                )}
                {live && <div style={{ color: '#6abaff', fontWeight: 700, fontSize: '0.82rem' }}>In Progress</div>}
                {state === 'finished' && <div style={{ color: '#9fb4d8', fontWeight: 700, fontSize: '0.82rem' }}>{q.cancelled ? 'Cancelled' : 'Finished'}</div>}
              </div>
            </div>

            {/* Stats row — server numbers only */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: '0.76rem', color: '#9fb4d8', flexWrap: 'wrap' }}>
              <span>👥 <strong style={{ color: '#fff' }}>{q.players}{q.maxPlayers ? `/${q.maxPlayers}` : ''}</strong> registered</span>
              {q.structure?.startingStack && <span>🎰 Stack: <strong style={{ color: '#fff' }}>{q.structure.startingStack.toLocaleString()}</strong></span>}
              {seatsLine && <span style={{ color: '#ffd24a' }}>🎟 {seatsLine}</span>}
              {qs && qs.qualified && !live && state !== 'finished' && (
                <span style={{ color: '#ffd24a' }}>✓ {qs.credits} credit{qs.credits === 1 ? '' : 's'}</span>
              )}
              {state === 'open' && q.signupClosesAt != null && (
                <span style={{ color: '#ffd24a' }}>⏱ Signup closes in {formatCountdown(q.signupClosesAt, now)}</span>
              )}
              {state === 'late' && q.lateRegUntil != null && (
                <span style={{ color: '#6abaff' }}>⏱ Late registration until {formatWhen(q.lateRegUntil)}</span>
              )}
            </div>

            {/* How to qualify — the official guidelines. */}
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(90,140,230,0.06)', border: '1px solid rgba(90,140,230,0.18)', fontSize: '0.76rem', color: '#9fb4d8', lineHeight: 1.5 }}>
              <div style={{ color: '#cfe0ff', fontWeight: 700, marginBottom: 4, fontSize: '0.7rem', letterSpacing: '0.05em' }}>📋 HOW TO QUALIFY</div>
              {q.type === 'monthly' ? (
                <>Three ways in: <strong style={{ color: '#fff' }}>top 10%</strong> of any Weekly online qualifier · <strong style={{ color: '#fff' }}>top 20%</strong> of each league's leaderboard (auto-added on the 1st) · <strong style={{ color: '#fff' }}>top 20%</strong> of your venue's average attendance.{seatsLine ? ` ${seatsLine} at Bally's Blackhawk.` : ''}</>
              ) : (
                <>Finish <strong style={{ color: '#fff' }}>top 5 in any live game</strong> at any venue to earn a credit and an entry here.{seatsLine ? ` ${seatsLine} at Bally's Blackhawk;` : ''} the top 10% advance to the Monthly Major.</>
              )}
            </div>

            {renderAction(q)}
          </div>
        );
      })}

      {dashboardNode}
    </div>
  );
}
