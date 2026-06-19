import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTableStore } from '../../store/tableStore';
import { useGameStore } from '../../store/gameStore';
import './BankrollGraph.css';

// 2026-06-19 fix: this graph used to read a `poker_bankroll_history`
// sessionStorage key that NOTHING in the app ever wrote — so it was always
// empty. It now derives the series from the DURABLE per-hand history the server
// loads at login (tableStore.handHistories, sourced from loadHandHistory), using
// the hero's end-of-hand table stack per hand. Real data, survives refresh.

export default function BankrollGraph({ onClose }) {
  const [view, setView] = useState('last50');
  const [tooltip, setTooltip] = useState(null);
  const handHistories = useTableStore((s) => s.handHistories);
  const heroName = useGameStore((s) => s.playerName);

  // Build a cumulative stack series: one point per hand the hero was dealt in.
  const allData = useMemo(() => {
    const out = [];
    for (const rec of handHistories || []) {
      const me = (rec?.players || []).find((p) => p.name === heroName);
      if (!me || typeof me.endChips !== 'number') continue;
      out.push({ chips: me.endChips, label: rec.handNumber != null ? `Hand #${rec.handNumber}` : `Hand ${out.length + 1}` });
    }
    return out;
  }, [handHistories, heroName]);

  const data = useMemo(() => {
    if (view === 'last50') return allData.slice(-50);
    if (view === 'session') return allData.slice(-15);
    return allData; // all available
  }, [view, allData]);

  if (data.length < 2) {
    return createPortal(
      <div className="bankroll-overlay" onClick={onClose}>
        <div className="bankroll-panel" onClick={(e) => e.stopPropagation()}>
          <div className="bankroll-header">
            <div className="bankroll-title">Bankroll Graph</div>
            <button className="bankroll-close" onClick={onClose}>Close</button>
          </div>
          <div className="bankroll-empty">
            Play more hands to see your bankroll graph. Data points are recorded after each hand.
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
  const startingStack = data[0].chips;

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
          <div className="bankroll-title">Bankroll Graph</div>
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
              <div className="bankroll-tooltip-chips">{tooltip.chips.toLocaleString()} chips</div>
              <div className="bankroll-tooltip-time">{tooltip.label}</div>
            </div>
          )}
        </div>

        <div className="bankroll-summary">
          <div className="bankroll-summary-card">
            <div className="bankroll-summary-value" style={{ color: lineColor }}>
              {netChange >= 0 ? '+' : ''}{netChange.toLocaleString()}
            </div>
            <div className="bankroll-summary-label">Net Change</div>
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
