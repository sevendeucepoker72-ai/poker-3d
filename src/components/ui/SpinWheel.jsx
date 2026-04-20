import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import './SpinWheel.css';

const SEGMENTS = [
  { label: '100', value: 100, type: 'chips', color: '#3B82F6', icon: '\uD83D\uDCB0' },
  { label: '250', value: 250, type: 'chips', color: '#8B5CF6', icon: '\uD83D\uDCB0' },
  { label: '500', value: 500, type: 'chips', color: '#22C55E', icon: '\uD83D\uDCB0' },
  { label: '1,000', value: 1000, type: 'chips', color: '#EF4444', icon: '\uD83D\uDCB0' },
  { label: '2,500', value: 2500, type: 'chips', color: '#F97316', icon: '\uD83D\uDCB0' },
  { label: '5,000', value: 5000, type: 'chips', color: '#EC4899', icon: '\uD83D\uDCB0' },
  { label: '2x XP', value: 2, type: 'xp_multiplier', color: '#06B6D4', icon: '\u2B50' },
  { label: 'Mystery', value: 0, type: 'mystery', color: '#A855F7', icon: '\uD83C\uDF81' },
];

export default function SpinWheel({ onClose }) {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [prize, setPrize] = useState(null);
  const [canSpin, setCanSpin] = useState(true); // server is source of truth; optimistic
  const [errMsg, setErrMsg] = useState(null);
  const discRef = useRef(null);
  // Track pending listener + timeouts so unmount mid-spin cleans up, AND a
  // response that never arrives doesn't leave a ghost handler on the socket.
  const activeListenerRef = useRef(null);
  const timeoutIdsRef = useRef(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const sock = getSocket();
      if (sock && activeListenerRef.current) {
        sock.off('dailySpinClaimed', activeListenerRef.current);
      }
      timeoutIdsRef.current.forEach(clearTimeout);
      timeoutIdsRef.current.clear();
    };
  }, []);

  // Hardware back button closes the modal
  useBackButtonClose(true, onClose);

  const segAngle = 360 / SEGMENTS.length;

  const doSpin = useCallback(() => {
    if (spinning || !canSpin) return;
    setErrMsg(null);
    setSpinning(true);

    const socket = getSocket();
    if (!socket) { setSpinning(false); return; }

    // Hard fail-safe: if the server response never arrives, unblock the UI
    // after 15s so the user can retry instead of being stuck spinning.
    const timeoutGuard = setTimeout(() => {
      if (!mountedRef.current) return;
      if (activeListenerRef.current) {
        socket.off('dailySpinClaimed', activeListenerRef.current);
        activeListenerRef.current = null;
      }
      setSpinning(false);
      setErrMsg('Spin timed out — please try again.');
      timeoutIdsRef.current.delete(timeoutGuard);
    }, 15000);
    timeoutIdsRef.current.add(timeoutGuard);

    // Server determines the prize + rate-limits. We animate visually while waiting.
    const onResult = (res) => {
      socket.off('dailySpinClaimed', onResult);
      if (activeListenerRef.current === onResult) activeListenerRef.current = null;
      clearTimeout(timeoutGuard);
      timeoutIdsRef.current.delete(timeoutGuard);
      if (!mountedRef.current) return;

      if (!res?.success) {
        const t1 = setTimeout(() => {
          timeoutIdsRef.current.delete(t1);
          if (!mountedRef.current) return;
          setSpinning(false);
          setCanSpin(false);
          setErrMsg(res?.error === 'already_claimed' ? 'You already used your daily spin!' : 'Could not claim spin');
        }, 800);
        timeoutIdsRef.current.add(t1);
        return;
      }

      // Map server reward → closest SEGMENTS index for the visual stop.
      const reward = res.reward || {};
      let winnerIndex = 5; // default fallback
      if (reward.stars && reward.stars >= 50) winnerIndex = 6;
      else if (reward.stars) winnerIndex = 7;
      else if (reward.chips >= 10000) winnerIndex = 5;
      else if (reward.chips >= 5000) winnerIndex = 5;
      else if (reward.chips >= 2500) winnerIndex = 4;
      else if (reward.chips >= 1000) winnerIndex = 3;
      else if (reward.chips >= 500)  winnerIndex = 2;
      else if (reward.chips >= 250)  winnerIndex = 1;
      else                           winnerIndex = 0;

      const segMiddle = winnerIndex * segAngle + segAngle / 2;
      const extraSpins = 5 + Math.floor(Math.random() * 3);
      setRotation((prev) => prev + extraSpins * 360 + (360 - segMiddle));

      const t2 = setTimeout(() => {
        timeoutIdsRef.current.delete(t2);
        if (!mountedRef.current) return;
        setSpinning(false);
        setPrize({ ...SEGMENTS[winnerIndex], serverLabel: reward.label });
        setCanSpin(false);
      }, 4200);
      timeoutIdsRef.current.add(t2);
    };

    activeListenerRef.current = onResult;
    socket.on('dailySpinClaimed', onResult);
    socket.emit('claimDailySpinServer');
  }, [spinning, canSpin, segAngle]);

  const closePrize = () => setPrize(null);

  // Build SVG wheel segments
  const segmentElements = SEGMENTS.map((seg, i) => {
    const startAngle = i * segAngle;
    const endAngle = (i + 1) * segAngle;
    const startRad = (startAngle - 90) * (Math.PI / 180);
    const endRad = (endAngle - 90) * (Math.PI / 180);
    const x1 = 140 + 130 * Math.cos(startRad);
    const y1 = 140 + 130 * Math.sin(startRad);
    const x2 = 140 + 130 * Math.cos(endRad);
    const y2 = 140 + 130 * Math.sin(endRad);
    const largeArc = segAngle > 180 ? 1 : 0;

    const midAngle = ((startAngle + endAngle) / 2 - 90) * (Math.PI / 180);
    const labelX = 140 + 85 * Math.cos(midAngle);
    const labelY = 140 + 85 * Math.sin(midAngle);
    const labelRotation = (startAngle + endAngle) / 2;

    return (
      <g key={i}>
        <path
          d={`M 140 140 L ${x1} ${y1} A 130 130 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill={seg.color}
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="1"
        />
        <text
          x={labelX}
          y={labelY}
          fill="#fff"
          fontSize="11"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${labelRotation}, ${labelX}, ${labelY})`}
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
        >
          {seg.label}
        </text>
      </g>
    );
  });

  return createPortal(
    <>
      <div className="spin-wheel-overlay" onClick={onClose}>
        <div className="spin-wheel-panel" onClick={(e) => e.stopPropagation()}>
          <div className="spin-wheel-header">
            <div className="spin-wheel-title">Daily Spin</div>
            <button className="spin-wheel-close" onClick={onClose}>Close</button>
          </div>

          <div className="spin-wheel-container">
            <div className="spin-wheel-pointer" />
            <div
              ref={discRef}
              className={`spin-wheel-disc ${spinning ? 'spinning' : ''}`}
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              <svg viewBox="0 0 280 280" width="100%" height="100%">
                {segmentElements}
              </svg>
            </div>
            <div className="spin-wheel-center">SPIN</div>
          </div>

          <button
            className="spin-wheel-btn"
            onClick={doSpin}
            disabled={spinning || !canSpin}
          >
            {spinning ? 'Spinning...' : canSpin ? 'SPIN FREE!' : 'Come Back Tomorrow'}
          </button>

          {!canSpin && !spinning && (
            <div className="spin-wheel-cooldown">
              You have already used your free daily spin.
            </div>
          )}
          {errMsg && (
            <div className="spin-wheel-cooldown" style={{ color: '#F59E0B' }}>{errMsg}</div>
          )}
        </div>
      </div>

      {prize && (
        <div className="spin-prize-popup" onClick={closePrize}>
          <div className="spin-prize-card" onClick={(e) => e.stopPropagation()}>
            <span className="spin-prize-icon">{prize.icon}</span>
            <div className="spin-prize-label">
              {prize.serverLabel || (
                prize.type === 'chips' ? `${prize.value.toLocaleString()} Chips!` :
                prize.type === 'xp_multiplier' ? '2x XP Boost!' :
                'Mystery Prize!'
              )}
            </div>
            <div className="spin-prize-desc">
              {prize.type === 'chips' && 'Chips have been added to your balance.'}
              {prize.type === 'xp_multiplier' && 'Double XP for your next 10 hands!'}
              {prize.type === 'mystery' && 'A random bonus has been added to your account!'}
            </div>
            <button className="spin-prize-claim-btn" onClick={closePrize}>Awesome!</button>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
