/**
 * ProducerPanel — the broadcast producer's console (lead spec C6 + R3 + R12,
 * 2026-11-02). Staff only: a lazy screen in the MAIN app, opened from the
 * Lobby's admin bar (isAdmin) or with ?producer=1 after sign-in (App.jsx,
 * consumed once). A non-admin sees "Staff only." — the server enforces it
 * anyway (broadcastIssueToken needs isUserAdmin AND the login's is_admin
 * claim, and refuses an entrant).
 *
 * How it connects: a PRODUCER token minted on the signed-in main socket
 * (`broadcastIssueToken` {ev:'ch:*', scopes:['producer'], label:'Producer
 * panel', ttlHours:2}), held in memory only, then its own socket to the
 * `/broadcast` namespace with that token (no OIDC there). A refused / expired
 * token is re-minted (at most 3 times a minute); a key someone REVOKED is not
 * (the panel waits for Try again). Review 2026-11-02: the key is renewed while
 * the panel is open and revoked when it closes or the page goes away, so an
 * admin who only looked at the panel is not barred from the qualifiers (a live
 * 'ch:*' key counts as broadcasting every event). Everything the show needs
 * lives on the server (program, scene, featured table, lower thirds, feed,
 * on air), so the panel survives its own reload and two producers see the
 * same state.
 *
 * Sections: event picker, program monitor (the same Stage OBS gets), scene
 * board, live multiview (public table summaries, a Feature button each, NO
 * cards), lower thirds, feed / on air / hole cards (P5, built dark), health,
 * keys for OBS sources, go-live checklist. The poker-admin Broadcasts page
 * runs scheduling, Facebook and the cloud worker (spec R12): linked in the head.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import { SERVER_URL } from '../../config.js';
import { requestProducerToken, createProducerSocket } from './producerSocket.js';
import {
  refusalText, programOf, CHANNELS, ADMIN_URL, isObj,
  panelTokenRefusalAction, panelKeyIsDead, panelRenewDelayMs, PANEL_TOKEN_RENEW_RETRY_MS,
} from './producerModel.js';
import EventPicker from './EventPicker.jsx';
import ProgramMonitor from './ProgramMonitor.jsx';
import SceneBoard from './SceneBoard.jsx';
import LiveMultiview from './LiveMultiview.jsx';
import LowerThirdComposer from './LowerThirdComposer.jsx';
import FeedControl from './FeedControl.jsx';
import HealthPanel from './HealthPanel.jsx';
import KeyManager from './KeyManager.jsx';
import GoLiveChecklist from './GoLiveChecklist.jsx';
import './ProducerPanel.css';

const MAX_MINTS_PER_MINUTE = 3;
const HELLO_REFRESH_MS = 10000;
const MAX_PENDING_REVOKE_TRIES = 6;
const ORPHAN_REVOKE_TIMEOUT_MS = 15000;

/**
 * A panel key minted after the panel stopped needing it (closed while the
 * mint was in flight): connect with it just long enough to revoke it, so it
 * never lingers as a live 'ch:*' key.
 */
function revokeOrphanKey(res) {
  if (!res || !res.ok || typeof res.token !== 'string' || !res.jti) return;
  let s = null;
  const stop = setTimeout(() => { if (s) s.close(); }, ORPHAN_REVOKE_TIMEOUT_MS);
  s = createProducerSocket({
    io,
    serverUrl: SERVER_URL,
    token: res.token,
    on: {
      hello: () => { clearTimeout(stop); s.retire({ jti: res.jti }); },
      tokenRefused: () => clearTimeout(stop),
    },
  });
}

function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function StaffOnly({ onClose }) {
  return (
    <div className="bc-producer bc-producer--staff-only" role="dialog" aria-label="Producer">
      <div className="bcp-staff">
        <div className="bcp-staff__title">Staff only.</div>
        <div className="bcp-staff__sub">The broadcast producer is for American Pub Poker staff.</div>
        <button type="button" className="bcp-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ProducerConsole({ onClose }) {
  const [phase, setPhase] = useState('token'); // token | ready | error
  const [errorCode, setErrorCode] = useState(null);
  const [conn, setConn] = useState({ connected: false, refused: null });
  const [hello, setHello] = useState(null);
  const [channel, setChannel] = useState('main');
  const [pstate, setPstate] = useState(null); // {payload, at}
  const [notice, setNotice] = useState(null); // {tone: 'ok' | 'warn', text}
  const [generation, setGeneration] = useState(0);
  const sockRef = useRef(null);
  const jtiRef = useRef(null);                  // the live panel key's jti (never the token)
  const preMintedRef = useRef(null);            // a renewal key, minted while the old one still worked
  const pendingRevokesRef = useRef(new Map());  // jti -> tries: old panel keys not revoked yet
  const mintsRef = useRef([]);
  const now = useNow(1000);

  // Mint the panel token, then connect to /broadcast with it. A new
  // `generation` (a refused token, Retry, or a renewal) mints again.
  // Review 2026-11-02 — the key is 2 hours and REVOKED when the panel is done
  // with it: on Close / unmount (retire: revoke, then close), on a renewal
  // (the old key), and when the page goes away (pagehide, below). A key that
  // could not be revoked then is revoked by the next panel socket.
  useEffect(() => {
    let cancelled = false;
    let sock = null;
    let jti = null;
    let dead = false;
    let renewTimer = null;
    const pending = pendingRevokesRef.current;
    const t = Date.now();
    const preMinted = preMintedRef.current;
    preMintedRef.current = null;
    if (!preMinted) {
      mintsRef.current = mintsRef.current.filter((x) => t - x < 60000);
      if (mintsRef.current.length >= MAX_MINTS_PER_MINUTE) {
        Promise.resolve().then(() => {
          if (cancelled) return;
          setErrorCode('rate_limited');
          setPhase('error');
        });
        return () => { cancelled = true; };
      }
      mintsRef.current.push(t);
    }

    const drainPendingRevokes = () => {
      const s = sock;
      if (!s) return;
      for (const [old, tries] of [...pending]) {
        if (old === jti) continue;
        s.call('revokeKey', { jti: old }).then((r) => {
          if ((r && r.ok) || tries + 1 >= MAX_PENDING_REVOKE_TRIES) pending.delete(old);
          else pending.set(old, tries + 1);
        });
      }
    };

    const scheduleRenew = (ms) => {
      if (renewTimer) clearTimeout(renewTimer);
      renewTimer = setTimeout(() => {
        renewTimer = null;
        if (cancelled) return;
        requestProducerToken(getSocket()).then((r) => {
          if (cancelled) { revokeOrphanKey(r); return; }
          if (!r.ok) {
            // The current key keeps working; try again in a while.
            setNotice({ tone: 'warn', text: refusalText('renew_failed') });
            scheduleRenew(PANEL_TOKEN_RENEW_RETRY_MS);
            return;
          }
          preMintedRef.current = r;
          setGeneration((g) => g + 1);
        });
      }, ms);
    };

    const start = (res) => {
      if (cancelled) { revokeOrphanKey(res); return; }
      if (!res.ok) {
        setErrorCode(res.code);
        setPhase('error');
        return;
      }
      jti = res.jti;
      jtiRef.current = jti;
      sock = createProducerSocket({
        io,
        serverUrl: SERVER_URL,
        token: res.token,
        on: {
          status: (s) => { if (!cancelled) setConn(s); },
          hello: (r) => {
            if (cancelled || !r || !r.ok) return;
            setHello({ ...r, at: Date.now() });
            drainPendingRevokes();
          },
          state: (p) => { if (!cancelled && isObj(p)) setPstate({ payload: p, at: Date.now() }); },
          tokenRefused: (code, via) => {
            if (cancelled) return;
            if (panelKeyIsDead(code, via)) dead = true;
            if (panelTokenRefusalAction(code, via) === 'stop') {
              // Someone revoked this panel's key: no new key until "Try again".
              dead = true;
              if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
              setErrorCode('panel_key_revoked');
              setPhase('error');
              return;
            }
            setNotice({ tone: 'warn', text: refusalText(code) });
            setPhase('token');
            setGeneration((g) => g + 1);
          },
        },
      });
      sockRef.current = sock;
      setPhase('ready');
      scheduleRenew(panelRenewDelayMs(res));
    };
    if (preMinted) Promise.resolve().then(() => start(preMinted));
    else requestProducerToken(getSocket()).then(start);

    return () => {
      cancelled = true;
      if (renewTimer) clearTimeout(renewTimer);
      if (sockRef.current === sock) sockRef.current = null;
      if (jtiRef.current === jti) jtiRef.current = null;
      if (!sock) return;
      if (dead || !jti) { sock.close(); return; }
      const mine = jti;
      sock.retire({ jti: mine }).then((ok) => {
        if (!ok && !pending.has(mine)) pending.set(mine, 0);
      });
    };
  }, [generation]);

  // Leaving the page (close, reload, navigate away): revoke the panel key now.
  // A page kept in the back/forward cache may come back, so it keeps its key.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHide = (e) => {
      if (e && e.persisted) return;
      const s = sockRef.current;
      const j = jtiRef.current;
      if (s && j) s.revokeNow(j);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // Watch the chosen channel (the socket re-watches it after a reconnect).
  useEffect(() => {
    if (phase !== 'ready' || !conn.connected || !sockRef.current) return;
    sockRef.current.watch(channel).then((res) => {
      if (res && !res.ok) setNotice({ tone: 'warn', text: refusalText(res.code) });
    });
  }, [phase, channel, conn.connected]);

  // Subscriber counts / outputs per channel: hello again every 10 s.
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const id = setInterval(() => { if (sockRef.current) sockRef.current.hello(); }, HELLO_REFRESH_MS);
    return () => clearInterval(id);
  }, [phase]);

  const call = useCallback(async (name, payload, okText = '') => {
    const s = sockRef.current;
    if (!s) {
      setNotice({ tone: 'warn', text: refusalText('not_connected') });
      return { ok: false, code: 'not_connected' };
    }
    const res = await s.call(name, payload);
    if (!res.ok) setNotice({ tone: 'warn', text: refusalText(res.code) });
    else if (okText) setNotice({ tone: 'ok', text: okText });
    return res;
  }, []);

  const retry = useCallback(() => {
    setErrorCode(null);
    setPhase('token');
    mintsRef.current = [];
    setGeneration((g) => g + 1);
  }, []);

  const payload = pstate ? pstate.payload : null;
  // Only the state of the channel on screen (a push for another channel after a switch is ignored).
  const watched = payload && isObj(payload.program) && isObj(payload.program.program)
    && (payload.program.program.channel === channel || payload.program.program.channel == null) ? payload : null;
  const program = programOf(watched);
  const stateAgeMs = pstate ? Math.max(0, now - pstate.at) : null;
  const channelRow = useMemo(() => {
    const rows = hello && Array.isArray(hello.channels) ? hello.channels : [];
    return rows.find((r) => isObj(r) && r.channel === channel) || null;
  }, [hello, channel]);
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';

  return (
    <div className="bc-producer" role="dialog" aria-label="Broadcast producer">
      <div className="bcp-head">
        <div className="bcp-head__title">Broadcast producer</div>
        <div className={`bcp-conn bcp-conn--${conn.connected ? 'on' : 'off'}`}>
          {phase === 'token' ? 'Getting the panel key…' : (conn.connected ? 'Connected' : 'Connecting…')}
        </div>
        <a className="bcp-head__link" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin: schedule, Facebook, worker</a>
        <button type="button" className="bcp-btn bcp-btn--ghost" onClick={onClose}>Close</button>
      </div>
      {notice ? <div className={`bcp-note bcp-note--${notice.tone}`} role="status">{notice.text}</div> : null}
      {phase === 'error' ? (
        <div className="bcp-card bcp-error">
          <div className="bcp-card__title">The producer panel could not start</div>
          <div className="bcp-note bcp-note--warn">{refusalText(errorCode)}</div>
          <button type="button" className="bcp-btn" onClick={retry}>Try again</button>
        </div>
      ) : (
        <div className="bcp-grid">
          <div className="bcp-col">
            <EventPicker hello={hello} channel={channel} channels={CHANNELS} onChannel={setChannel} program={program} call={call} />
            <ProgramMonitor state={watched} stateAt={pstate ? pstate.at : null} />
            <SceneBoard program={program} channel={channel} call={call} />
            <LowerThirdComposer program={program} table={watched && isObj(watched.program) ? watched.program.table : null} channel={channel} call={call} stateAt={pstate ? pstate.at : null} />
          </div>
          <div className="bcp-col">
            <LiveMultiview state={watched} program={program} channel={channel} call={call} />
            <FeedControl state={watched} program={program} channel={channel} call={call} />
            <HealthPanel hello={hello} channelRow={channelRow} state={watched} stateAgeMs={stateAgeMs} conn={conn} />
            <KeyManager program={program} channel={channel} call={call} origin={origin} connected={conn.connected} />
            <GoLiveChecklist program={program} channelRow={channelRow} stateAgeMs={stateAgeMs} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProducerPanel({ onClose }) {
  const isAdmin = useGameStore((s) => !!s.isAdmin);
  if (!isAdmin) return <StaffOnly onClose={onClose} />;
  return <ProducerConsole onClose={onClose} />;
}
