import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import { useGameStore } from '../../store/gameStore';
import { useProgressStore } from '../../store/progressStore';
import { DEFAULT_SPIN_SEGMENTS, normalizeSpinSegments, segmentForSpinResult, formatReward, shopErrorText } from '../../utils/economyCatalog';
import { denverDateKey, nextDenverMidnightMs, formatCountdown } from '../../utils/denverTime';
import './SpinWheel.css';

// 2026-10-11 (.online R2 — APPUI-37). The wheel shows the server's REAL prize
// table — each prize once, its slice sized by its odds — and stops on the
// prize the server paid (claimDailySpinServer → dailySpinClaimed { success,
// reward, segmentId? }). It used to draw eight made-up prizes (100 / 250 /
// 2x XP / Mystery …) the server never pays and "Double XP for your next 10
// hands!" copy. The server's `spinWheelConfig` answer to getSpinWheel
// ({ segments, claimedToday, resetsAt }) replaces the built-in table and says
// whether today's spin is used (so is playerProgress.dailySpinClaimed). One
// spin per Denver day.

const SPIN_SEEN_KEY = 'app_poker_spin_seen';
const SEGMENT_COLORS = ['#1d4ed8', '#7c3aed', '#0f766e', '#b45309', '#2563eb', '#6d28d9'];

function seenKey(userId) {
  return `${SPIN_SEEN_KEY}:${userId == null ? 'anon' : String(userId)}`;
}
/** Has this account's daily spin been auto-shown / used today (Denver)? */
export function spinSeenToday(userId) {
  try { return localStorage.getItem(seenKey(userId)) === denverDateKey(); } catch { return false; }
}
export function markSpinSeenToday(userId) {
  try { localStorage.setItem(seenKey(userId), denverDateKey()); } catch { /* ignore */ }
}

function segIcon(seg) {
  return seg.stars > 0 && !(seg.chips > 0) ? '⭐' : '🪙';
}

export default function SpinWheel({ onClose }) {
  const userId = useGameStore((s) => s.userId);
  const usedToday = useProgressStore((s) => s.progress?.dailySpinClaimed === true);
  const [segments, setSegments] = useState(DEFAULT_SPIN_SEGMENTS);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [prize, setPrize] = useState(null); // { icon, text }
  const [canSpin, setCanSpin] = useState(!usedToday);
  const [resetsAt, setResetsAt] = useState(null); // the server's next Denver midnight
  const [errMsg, setErrMsg] = useState(null);
  const activeListenerRef = useRef(null);
  const timeoutIdsRef = useRef(new Set());
  const mountedRef = useRef(true);
  // R2 review (K2-1) — the wheel handler (bound once) reads these.
  const spinningRef = useRef(false);
  const prizeRef = useRef(null);
  spinningRef.current = spinning;
  prizeRef.current = prize;

  useEffect(() => {
    mountedRef.current = true;
    const sock = getSocket();
    const onWheel = (payload) => {
      if (!mountedRef.current) return;
      const list = normalizeSpinSegments(Array.isArray(payload) ? payload : payload?.segments);
      if (list) setSegments(list);
      const r = Number(payload?.resetsAt);
      if (Number.isFinite(r) && r > Date.now()) setResetsAt(r);
      if (payload?.claimedToday === true) {
        setCanSpin(false);
        markSpinSeenToday(userId);
      } else if (payload?.claimedToday === false && !spinningRef.current && !prizeRef.current) {
        // R2 review (K2-1) — the server says today's spin is free (a new
        // Denver day since this lobby last heard): never keep yesterday's lock.
        setCanSpin(true);
      }
    };
    if (sock) {
      sock.on('spinWheelConfig', onWheel);
      try { sock.emit('getSpinWheel'); } catch { /* an older server has no table to send */ }
    }
    return () => {
      mountedRef.current = false;
      if (sock) {
        sock.off('spinWheelConfig', onWheel);
        if (activeListenerRef.current) sock.off('dailySpinClaimed', activeListenerRef.current);
      }
      timeoutIdsRef.current.forEach(clearTimeout);
      timeoutIdsRef.current.clear();
    };
  }, []);

  useBackButtonClose(true, onClose);

  // The server's playerProgress says today's spin is used (another tab / device).
  // R2 review (K2-1) — both ways: after Denver midnight the fresh progress says
  // the spin is free again, and the wheel unlocks without a reload.
  useEffect(() => { if (!spinning && !prize) setCanSpin(!usedToday); }, [usedToday, spinning, prize]);
  const nextSpinAt = resetsAt && resetsAt > Date.now() ? resetsAt : nextDenverMidnightMs();

  // Slice angles by odds (weight).
  const total = segments.reduce((s, x) => s + (x.weight || 1), 0) || 1;
  const arcs = [];
  let acc = 0;
  for (const seg of segments) {
    const span = ((seg.weight || 1) / total) * 360;
    arcs.push({ start: acc, end: acc + span });
    acc += span;
  }

  const later = (fn, ms) => {
    const t = setTimeout(() => { timeoutIdsRef.current.delete(t); if (mountedRef.current) fn(); }, ms);
    timeoutIdsRef.current.add(t);
  };

  const doSpin = useCallback(() => {
    if (spinning || !canSpin) return;
    const socket = getSocket();
    if (!socket || !socket.connected) { setErrMsg('Not connected — try again in a moment.'); return; }
    setErrMsg(null);
    setSpinning(true);
    // Keep the wheel moving while the server decides.
    setRotation((r) => r + 720);

    let answered = false;
    const onResult = (res) => {
      if (answered) return;
      answered = true;
      socket.off('dailySpinClaimed', onResult);
      if (activeListenerRef.current === onResult) activeListenerRef.current = null;
      if (!mountedRef.current) return;
      if (!res?.success) {
        later(() => {
          setSpinning(false);
          if (res?.error === 'already_claimed') {
            setCanSpin(false);
            markSpinSeenToday(userId);
            setErrMsg(`You already used today's spin — the next one opens in ${formatCountdown(nextSpinAt)}.`);
          } else {
            setErrMsg(shopErrorText(res, 'Could not spin — try again.'));
          }
        }, 600);
        return;
      }
      markSpinSeenToday(userId);
      const reward = res.reward || {};
      const idx = segmentForSpinResult(segments, res);
      setRotation((prev) => {
        const turns = 5 + Math.floor(Math.random() * 3);
        if (idx < 0) return prev + turns * 360; // a prize this wheel does not show: no fake stop
        const mid = (arcs[idx].start + arcs[idx].end) / 2;
        const base = prev - (prev % 360);
        return base + turns * 360 + (360 - mid);
      });
      later(() => {
        setSpinning(false);
        setCanSpin(false);
        setPrize({ icon: idx >= 0 ? segIcon(segments[idx]) : '🎁', text: formatReward(reward) });
      }, 4200);
    };
    activeListenerRef.current = onResult;
    socket.on('dailySpinClaimed', onResult);
    later(() => {
      if (answered) return;
      answered = true;
      socket.off('dailySpinClaimed', onResult);
      setSpinning(false);
      setErrMsg('The game server did not answer — try again.');
    }, 15000);
    socket.emit('claimDailySpinServer');
  }, [spinning, canSpin, segments, arcs, userId, nextSpinAt]);

  const closePrize = () => setPrize(null);

  // SVG slices (sized by odds)
  const segmentElements = segments.map((seg, i) => {
    const { start, end } = arcs[i];
    const startRad = (start - 90) * (Math.PI / 180);
    const endRad = (end - 90) * (Math.PI / 180);
    const x1 = 140 + 130 * Math.cos(startRad);
    const y1 = 140 + 130 * Math.sin(startRad);
    const x2 = 140 + 130 * Math.cos(endRad);
    const y2 = 140 + 130 * Math.sin(endRad);
    const largeArc = end - start > 180 ? 1 : 0;
    const midAngle = ((start + end) / 2 - 90) * (Math.PI / 180);
    const labelX = 140 + 85 * Math.cos(midAngle);
    const labelY = 140 + 85 * Math.sin(midAngle);
    const labelRotation = (start + end) / 2;
    const pct = Math.round(((seg.weight || 1) / total) * 100);
    return (
      <g key={seg.id}>
        <path
          d={`M 140 140 L ${x1} ${y1} A 130 130 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
          stroke="rgba(255,210,74,0.55)"
          strokeWidth="1.5"
        />
        <text
          x={labelX}
          y={labelY}
          fill="#fff"
          fontSize={end - start < 30 ? 9 : 11}
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${labelRotation}, ${labelX}, ${labelY})`}
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
        >
          {seg.label}{end - start >= 40 ? ` · ${pct}%` : ''}
        </text>
      </g>
    );
  });

  return createPortal(
    <>
      <div className="spin-wheel-overlay" onClick={onClose}>
        <div className="spin-wheel-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Daily spin">
          <div className="spin-wheel-header">
            <div className="spin-wheel-title">Daily Spin</div>
            <button className="spin-wheel-close" onClick={onClose}>Close</button>
          </div>

          <div className="spin-wheel-container">
            <div className="spin-wheel-pointer" />
            <div
              className={`spin-wheel-disc ${spinning ? 'spinning' : ''}`}
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              <svg viewBox="0 0 280 280" width="100%" height="100%">
                {segmentElements}
              </svg>
            </div>
            <div className="spin-wheel-center">SPIN</div>
          </div>

          <div className="spin-wheel-odds">
            {segments.map((s) => (
              <span key={s.id}>{segIcon(s)} {s.label} — {Math.round(((s.weight || 1) / total) * 100)}%</span>
            ))}
          </div>

          <button
            className="spin-wheel-btn"
            onClick={doSpin}
            disabled={spinning || !canSpin}
          >
            {spinning ? 'Spinning...' : canSpin ? 'SPIN FREE!' : 'Come Back Tomorrow'}
          </button>

          {errMsg && <div className="spin-wheel-cooldown">{errMsg}</div>}
          {!canSpin && !spinning && !errMsg && (
            <div className="spin-wheel-cooldown">Next free spin in {formatCountdown(nextSpinAt)} (midnight, Denver time).</div>
          )}
        </div>
      </div>

      {prize && (
        <div className="spin-prize-popup" onClick={closePrize}>
          <div className="spin-prize-card" onClick={(e) => e.stopPropagation()}>
            <span className="spin-prize-icon">{prize.icon}</span>
            <div className="spin-prize-label">You won {prize.text}!</div>
            <div className="spin-prize-desc">Added to your balance.</div>
            <button className="spin-prize-claim-btn" onClick={closePrize}>Awesome!</button>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
