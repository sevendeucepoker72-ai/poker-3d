import { useState, useEffect, useRef, useCallback } from 'react';
import { useTableStore } from '../../store/tableStore';
import { getSocket } from '../../services/socketService';
import {
  createSessionLedger, observeSessionFrame, creditSessionRebuy, rebuySessionTarget,
  liveSessionKeys, sessionView,
} from '../../utils/sessionLedger';
import './SessionTracker.css';

export default function SessionTracker() {
  const gameState = useTableStore((s) => s.gameState);
  const mySeat = useTableStore((s) => s.mySeat);
  const activeTables = useTableStore((s) => s.activeTables);
  const connected = useTableStore((s) => s.connected);

  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [, setLedgerVersion] = useState(0);

  // Session data stored in refs to persist across renders
  const startTimeRef = useRef(Date.now());
  // Gameplay audit G178 (2026-10-21) — one session per table (a tournament's
  // table move keeps its own): its start stack, the wallet chips rebought
  // onto it (`rebuyComplete`), its chip history and hands. A bust + rebuy is
  // no longer "+0", and a Multi-Table switch shows that table's own P/L
  // (utils/sessionLedger.js).
  const ledgerRef = useRef(null);
  if (ledgerRef.current === null) ledgerRef.current = createSessionLedger();

  // Get current chip count
  const seats = gameState?.seats || [];
  const myPlayer = mySeat >= 0 && seats[mySeat] ? seats[mySeat] : null;

  // Each frame of the table on screen: baseline, history, hands (G171: one per
  // new hand number at the same table — a switch or the first frame is not one).
  useEffect(() => {
    const ledger = ledgerRef.current;
    const before = JSON.stringify(sessionView(ledger, gameState, myPlayer));
    observeSessionFrame(ledger, gameState, myPlayer, liveSessionKeys(gameState, activeTables));
    if (JSON.stringify(sessionView(ledger, gameState, myPlayer)) !== before) setLedgerVersion((v) => v + 1);
  }, [gameState, myPlayer, activeTables]);

  // Wallet chips put on a seat are not profit. The listener follows the socket
  // (a reconnect can replace it). C4 fix-up — the topped-up table's newest
  // frame here goes along: only a baseline taken from that very frame already
  // holds the top-up (a Multi-Table table seen once and topped up off screen
  // had its real rebuy skipped).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onRebuyComplete = (d) => {
      if (!d || d.success !== true) return;
      const target = rebuySessionTarget(d, useTableStore.getState());
      if (target) creditSessionRebuy(ledgerRef.current, target.key, d.added, d.newStack, target.frame);
      setLedgerVersion((v) => v + 1);
    };
    socket.on('rebuyComplete', onRebuyComplete);
    return () => socket.off('rebuyComplete', onRebuyComplete);
  }, [connected]);

  // Session timer - updates every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format elapsed time as HH:MM:SS
  const formatTime = useCallback((secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, []);

  // Calculate profit/loss (stack - start - wallet chips added, this table's session)
  const view = sessionView(ledgerRef.current, gameState, myPlayer);
  const myChips = view ? view.stack : (myPlayer?.chipCount ?? 0);
  const profit = view ? view.profit : 0;
  const profitDisplay = profit >= 0 ? `+${profit.toLocaleString()}` : profit.toLocaleString();
  const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';

  // Build sparkline SVG path
  const renderSparkline = () => {
    const data = view ? view.history : [];
    if (data.length < 2) return null;

    const width = 190;
    const height = 40;
    const padding = 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    // R3 (K1-7) — a losing session is amber, not red.
    const lineColor = profit >= 0 ? '#4ADE80' : '#F59E0B';
    const fillColor = profit >= 0 ? 'rgba(74,222,128,0.15)' : 'rgba(245,158,11,0.15)';

    // Create fill area (polygon closing to bottom)
    const firstX = padding;
    const lastX = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2);
    const fillPoints = `${firstX},${height} ${points.join(' ')} ${lastX},${height}`;

    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polygon points={fillPoints} fill={fillColor} />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Current value dot */}
        {data.length > 0 && (() => {
          const lastVal = data[data.length - 1];
          const cx = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2);
          const cy = height - padding - ((lastVal - min) / range) * (height - padding * 2);
          return <circle cx={cx} cy={cy} r="3" fill={lineColor} />;
        })()}
      </svg>
    );
  };

  if (!view) return null;

  if (!expanded) {
    return (
      <div className="session-tracker">
        <div className="session-tracker-collapsed" onClick={() => setExpanded(true)}>
          <span className={`session-profit ${profitClass}`}>{profitDisplay}</span>
          <span className={`session-expand-icon`}>&#9650;</span>
        </div>
      </div>
    );
  }

  return (
    <div className="session-tracker">
      <div className="session-tracker-panel">
        <div className="session-header" onClick={() => setExpanded(false)}>
          <span className="session-title">Session Stats</span>
          <button className="session-close">&#9660;</button>
        </div>

        <div className="session-stats">
          <div className="session-stat-row">
            <span className="session-stat-label">Duration</span>
            <span className="session-stat-value">{formatTime(elapsed)}</span>
          </div>

          <div className="session-stat-row">
            <span className="session-stat-label">Profit / Loss</span>
            <span className={`session-profit ${profitClass}`} style={{ fontSize: '0.95rem' }}>
              {profitDisplay}
            </span>
          </div>

          <div className="session-stat-row">
            <span className="session-stat-label">Hands Played</span>
            <span className="session-stat-value">{view.hands}</span>
          </div>

          <div className="session-stat-row">
            <span className="session-stat-label">Current Stack</span>
            <span className="session-stat-value">{myChips.toLocaleString()}</span>
          </div>

          <div className="session-sparkline">
            <div className="session-sparkline-label">Chip History</div>
            {renderSparkline()}
          </div>
        </div>
      </div>
    </div>
  );
}
