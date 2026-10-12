import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { summarizeOwnHands } from '../../utils/handLog';
import './BankrollGraph.css';

// 2026-10-11 (.online R2 — APPUI-51). The graph is HIS results: the chips he
// won or lost in each of his own hands (his row of each record — utils/handLog
// finds his seat), added up. It used to plot the end-of-hand TABLE STACK of a
// row matched by name from the table store's last 20 (cleared when he left a
// table), which jumps with every buy-in and is not a bankroll. Source: the
// lobby hand log (the server's stored hands for him + this session's).

export default function BankrollGraph({ onClose }) {
  const [view, setView] = useState('last50');
  const [tooltip, setTooltip] = useState(null);
  const handLog = useProgressStore((s) => s.handLog);
  const heroName = useGameStore((s) => s.playerName);

  // One point per hand of his: the running total of his chips won / lost.
  const allData = useMemo(() => summarizeOwnHands(handLog, heroName).series.map((s) => ({
    chips: s.cumulative,
    label: `${s.label} (${s.net >= 0 ? '+' : ''}${s.net.toLocaleString()})`,
  })), [handLog, heroName]);

  // The shown window starts at zero (its own running total).
  const data = useMemo(() => {
    const n = view === 'last50' ? 50 : view === 'session' ? 15 : allData.length;
    if (allData.length <= n) return allData;
    const base = allData[allData.length - n - 1].chips;
    return allData.slice(-n).map((d) => ({ ...d, chips: d.chips - base }));
  }, [view, allData]);

  if (data.length < 2) {
    return createPortal(
      <div className="bankroll-overlay" onClick={onClose}>
        <div className="bankroll-panel" onClick={(e) => e.stopPropagation()}>
          <div className="bankroll-header">
            <div className="bankroll-title">Your Results</div>
            <button className="bankroll-close" onClick={onClose}>Close</button>
          </div>
          <div className="bankroll-empty">
            Play a few more hands to see your results — each hand you play adds a point (chips won or lost, added up).
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const chips = data.map((d) => d.chips);
  const min = Math.min(...chips);
  const max = Math.max(...chips);
  const range = max - min || 1;
  const startingStack = 0;

  const w = 540;
  const h = 200;
  const pad = { top: 15, right: 15, bottom: 25, left: 15 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * chartW,
    y: pad.top + (1 - (d.chips - min) / range) * chartH,
    chips: d.chips,
    label: d.label,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPoints = `${points[0].x},${pad.top + chartH} ${polyline} ${points[points.length - 1].x},${pad.top + chartH}`;

  // Determine green/red sections
  const startY = pad.top + (1 - (startingStack - min) / range) * chartH;

  const currentChips = data[data.length - 1].chips;
  const netChange = currentChips - startingStack;
  const isUp = netChange >= 0;
  // No-red brand rule: down state uses muted steel-blue, not red.
  const lineColor = isUp ? '#27e0a0' : '#6b8cc4';
  const gradColor = lineColor;

  // Summary stats
  const highPoint = max;
  const lowPoint = min;

  return createPortal(
    <div className="bankroll-overlay" onClick={onClose}>
      <div className="bankroll-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bankroll-header">
          <div className="bankroll-title">Your Results</div>
          <button className="bankroll-close" onClick={onClose}>Close</button>
        </div>

        <div className="bankroll-toggle-bar">
          {[
            { key: 'last50', label: 'Last 50 Hands' },
            { key: 'session', label: 'Last 15' },
            { key: 'alltime', label: 'All Available' },
          ].map((opt) => (
            <button
              key={opt.key}
              className={`bankroll-toggle-btn ${view === opt.key ? 'active' : ''}`}
              onClick={() => setView(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="bankroll-chart-wrap">
          <svg className="bankroll-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="bankGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={gradColor} stopOpacity="0.25" />
                <stop offset="100%" stopColor={gradColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={pad.left} x2={w - pad.right}
                y1={pad.top + f * chartH} y2={pad.top + f * chartH}
                stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"
              />
            ))}

            {/* Starting stack line */}
            <line
              x1={pad.left} x2={w - pad.right}
              y1={startY} y2={startY}
              stroke="rgba(255,215,0,0.2)" strokeWidth="1" strokeDasharray="4,4"
            />

            {/* Area fill */}
            <polygon points={areaPoints} fill="url(#bankGrad)" />

            {/* Main line */}
            <polyline
              points={polyline}
              fill="none"
              stroke={lineColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Interactive hover points */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x} cy={p.y} r="4"
                fill="transparent"
                stroke="transparent"
                strokeWidth="8"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltip({ ...p, index: i })}
                onClick={() => setTooltip((t) => (t && t.index === i ? null : { ...p, index: i }))}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}

            {/* Highlighted point */}
            {tooltip && (
              <circle
                cx={tooltip.x} cy={tooltip.y} r="4"
                fill={lineColor} stroke="#fff" strokeWidth="1.5"
              />
            )}

            {/* Y-axis labels */}
            <text x={pad.left + 2} y={pad.top + 10} fill="#555" fontSize="9">{max.toLocaleString()}</text>
            <text x={pad.left + 2} y={pad.top + chartH - 2} fill="#555" fontSize="9">{min.toLocaleString()}</text>
          </svg>

          {tooltip && (
            <div
              className="bankroll-tooltip"
              style={{
                left: `${(tooltip.x / w) * 100}%`,
                top: `${(tooltip.y / h) * 100}%`,
              }}
            >
              <div className="bankroll-tooltip-chips">{tooltip.chips >= 0 ? '+' : ''}{tooltip.chips.toLocaleString()} total</div>
              <div className="bankroll-tooltip-time">{tooltip.label}</div>
            </div>
          )}
        </div>

        <div className="bankroll-summary">
          <div className="bankroll-summary-card">
            <div className="bankroll-summary-value" style={{ color: lineColor }}>
              {netChange >= 0 ? '+' : ''}{netChange.toLocaleString()}
            </div>
            <div className="bankroll-summary-label">Total (shown hands)</div>
          </div>
          <div className="bankroll-summary-card">
            <div className="bankroll-summary-value" style={{ color: '#27e0a0' }}>
              {highPoint.toLocaleString()}
            </div>
            <div className="bankroll-summary-label">Peak</div>
          </div>
          <div className="bankroll-summary-card">
            <div className="bankroll-summary-value" style={{ color: '#8298c4' }}>
              {lowPoint.toLocaleString()}
            </div>
            <div className="bankroll-summary-label">Valley</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
