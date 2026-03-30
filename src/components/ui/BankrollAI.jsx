import React, { useState, useMemo } from 'react';
import './BankrollAI.css';

// ─────────────────────────────────────────────────────────────────────────────
// Stake levels used for the progression chart and recommendations.
// Each entry: { label, bb, nlLabel }
// ─────────────────────────────────────────────────────────────────────────────
const STAKE_LEVELS = [
  { label: 'NL10',  bb: 10,  nlLabel: 'NL10'  },
  { label: 'NL25',  bb: 25,  nlLabel: 'NL25'  },
  { label: 'NL50',  bb: 50,  nlLabel: 'NL50'  },
  { label: 'NL100', bb: 100, nlLabel: 'NL100' },
  { label: 'NL200', bb: 200, nlLabel: 'NL200' },
];

// Conservative buy-in multipliers per tolerance level
const BUY_IN_MULTIPLIERS = {
  conservative: { moveUp: 30, moveDown: 18 },
  moderate:     { moveUp: 20, moveDown: 12 },
  aggressive:   { moveUp: 15, moveDown:  8 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a number as abbreviated chip string: 1 500 → "1,500" */
const fmt = n => (isFinite(n) ? Math.round(n).toLocaleString() : '∞');

/** Clamp a value between [min, max] */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ─────────────────────────────────────────────────────────────────────────────
// StakeChart – SVG showing bankroll thresholds
// ─────────────────────────────────────────────────────────────────────────────

function StakeChart({ bankroll, tolerance }) {
  const W = 440, H = 140;
  const PAD_L = 52, PAD_R = 16, PAD_T = 12, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // Compute move-up thresholds for all stake levels
  const thresholds = STAKE_LEVELS.map(s => {
    const buyIn = s.bb * 100;
    const muls = BUY_IN_MULTIPLIERS[tolerance] || BUY_IN_MULTIPLIERS.moderate;
    return { ...s, moveUp: buyIn * muls.moveUp };
  });

  const maxVal = Math.max(...thresholds.map(t => t.moveUp), bankroll) * 1.1;

  const xScale = v => PAD_L + (v / maxVal) * plotW;
  const yLine = i => PAD_T + ((i + 0.5) / STAKE_LEVELS.length) * plotH;

  return (
    <svg className="bai-stake-chart" viewBox={`0 0 ${W} ${H}`} aria-label="Stake progression chart">
      {/* Background */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH}
        fill="rgba(0,0,0,0.25)" rx="4" />

      {/* Threshold lines */}
      {thresholds.map((t, i) => {
        const x = xScale(t.moveUp);
        const y = yLine(i);
        return (
          <g key={t.label}>
            <line
              x1={PAD_L} y1={y} x2={clamp(x, PAD_L, PAD_L + plotW)} y2={y}
              stroke="rgba(0,255,255,0.35)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            {/* Label on left */}
            <text x={PAD_L - 4} y={y + 4} textAnchor="end"
              fill="rgba(0,255,255,0.7)" fontSize="9" fontFamily="monospace">
              {t.label}
            </text>
            {/* Chip value at right end of line */}
            {x <= PAD_L + plotW && (
              <text x={clamp(x + 3, PAD_L + 2, PAD_L + plotW - 2)} y={y - 3}
                fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">
                {fmt(t.moveUp)}
              </text>
            )}
          </g>
        );
      })}

      {/* Current bankroll vertical line */}
      {isFinite(bankroll) && bankroll > 0 && (
        <g>
          <line
            x1={xScale(bankroll)} y1={PAD_T}
            x2={xScale(bankroll)} y2={PAD_T + plotH}
            stroke="#F59E0B"
            strokeWidth="2"
          />
          <text
            x={xScale(bankroll)}
            y={PAD_T + plotH + 14}
            textAnchor="middle"
            fill="#F59E0B"
            fontSize="9"
            fontFamily="monospace"
          >
            {fmt(bankroll)}
          </text>
          {/* Arrow marker */}
          <polygon
            points={`${xScale(bankroll)},${PAD_T + plotH + 3} ${xScale(bankroll) - 4},${PAD_T + plotH} ${xScale(bankroll) + 4},${PAD_T + plotH}`}
            fill="#F59E0B"
          />
        </g>
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress Bar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color = '#22C55E' }) {
  const pct = clamp((value / max) * 100, 0, 100);
  return (
    <div className="bai-progress-track">
      <div
        className="bai-progress-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function BankrollAI({ currentChips, onClose }) {
  // ── Input state ──
  const [bankroll, setBankroll]   = useState(currentChips ?? 5000);
  const [sessions, setSessions]   = useState(20);
  const [winRate, setWinRate]     = useState(150);
  const [stdDev, setStdDev]       = useState(2000);
  const [targetBB, setTargetBB]   = useState(50);
  const [tolerance, setTolerance] = useState('moderate');

  // ── Calculations ──
  const calc = useMemo(() => {
    const br   = Number(bankroll)  || 0;
    const wr   = Number(winRate)   || 0;
    const sd   = Math.max(Number(stdDev) || 1, 1);
    const tbb  = Number(targetBB)  || 50;
    const muls = BUY_IN_MULTIPLIERS[tolerance] || BUY_IN_MULTIPLIERS.moderate;

    // Risk of ruin (Kelly-based approximation)
    const ror = wr > 0
      ? Math.min(Math.exp(-2 * wr * br / (sd * sd)) * 100, 100)
      : 100;

    // Buy-in size for target stake (1 buy-in = 100 BB in chips)
    const buyIn = tbb * 100;

    // Move-up / move-down thresholds
    const moveUpAt   = buyIn * muls.moveUp;
    const moveDownAt = buyIn * muls.moveDown;

    // Sessions to move up (ceiling)
    const sessionsToMoveUp = wr > 0
      ? Math.max(Math.ceil((moveUpAt - br) / wr), 0)
      : Infinity;

    // Kelly fraction (fraction of bankroll to risk per session)
    const kellyFraction = sd > 0 ? wr / (sd * sd) : 0;

    // Recommended stake: find the highest stake whose move-up threshold <= current bankroll
    let recBB = STAKE_LEVELS[0].bb;
    for (const sl of STAKE_LEVELS) {
      const slBuyIn   = sl.bb * 100;
      const slMoveUp  = slBuyIn * muls.moveUp;
      if (br >= slMoveUp) recBB = sl.bb;
    }

    // Direction vs target
    const direction = recBB > tbb ? 'above' : recBB < tbb ? 'below' : 'at';

    // Personalized advice
    const adviceLines = [];
    if (ror >= 20) {
      adviceLines.push('Your risk of ruin is high — consider dropping to a lower stake until your bankroll grows.');
    } else if (ror >= 5) {
      adviceLines.push('Moderate risk detected. Play tight to variance and avoid taking shots until bankroll strengthens.');
    } else {
      adviceLines.push('Bankroll looks healthy for your current stake. Stay disciplined and keep recording sessions.');
    }
    if (wr < 0) {
      adviceLines.push('Negative win rate suggests a leak in your game. Review hand histories before moving up.');
    } else if (wr > 0 && sessionsToMoveUp !== Infinity) {
      adviceLines.push(`At your current win rate you could move up in ~${sessionsToMoveUp} sessions — stay patient.`);
    }
    if (tolerance === 'aggressive' && ror > 10) {
      adviceLines.push('Aggressive tolerance with elevated ROR — consider shifting to Moderate to protect your roll.');
    }

    return {
      ror,
      buyIn,
      moveUpAt,
      moveDownAt,
      sessionsToMoveUp,
      kellyFraction,
      recBB,
      direction,
      adviceLines,
    };
  }, [bankroll, winRate, stdDev, targetBB, tolerance]);

  // ── ROR colour ──
  const rorColor = calc.ror < 5 ? '#22C55E' : calc.ror < 20 ? '#F59E0B' : '#EF4444';

  return (
    <div className="bai-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bai-modal">
        {/* ── Header ── */}
        <div className="bai-header">
          <div className="bai-header-left">
            <span className="bai-icon">♠</span>
            <span className="bai-title">BANKROLL AI</span>
          </div>
          <button className="bai-close" onClick={onClose} title="Close">×</button>
        </div>

        <div className="bai-content">
          {/* ── Left column: inputs ── */}
          <div className="bai-inputs">
            <h3 className="bai-section-title">Parameters</h3>

            <label className="bai-label">
              Current Chips
              <input
                className="bai-input"
                type="number"
                min={0}
                value={bankroll}
                onChange={e => setBankroll(e.target.value)}
              />
            </label>

            <label className="bai-label">
              Sessions Played
              <input
                className="bai-input"
                type="number"
                min={0}
                value={sessions}
                onChange={e => setSessions(e.target.value)}
              />
            </label>

            <label className="bai-label">
              Avg Win Rate <span className="bai-unit">(chips/session)</span>
              <input
                className="bai-input"
                type="number"
                value={winRate}
                onChange={e => setWinRate(e.target.value)}
              />
            </label>

            <label className="bai-label">
              Std Deviation <span className="bai-unit">(chips/session)</span>
              <input
                className="bai-input"
                type="number"
                min={1}
                value={stdDev}
                onChange={e => setStdDev(e.target.value)}
              />
            </label>

            <label className="bai-label">
              Target Stake <span className="bai-unit">(BB)</span>
              <select
                className="bai-input bai-select"
                value={targetBB}
                onChange={e => setTargetBB(Number(e.target.value))}
              >
                {STAKE_LEVELS.map(s => (
                  <option key={s.bb} value={s.bb}>{s.nlLabel} ({s.bb}BB)</option>
                ))}
              </select>
            </label>

            <div className="bai-label">
              Risk Tolerance
              <div className="bai-radio-group">
                {['conservative', 'moderate', 'aggressive'].map(t => (
                  <label key={t} className="bai-radio-label">
                    <input
                      type="radio"
                      name="tolerance"
                      value={t}
                      checked={tolerance === t}
                      onChange={() => setTolerance(t)}
                    />
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right column: results ── */}
          <div className="bai-results">
            {/* Big ROR number */}
            <div className="bai-ror-block">
              <div className="bai-ror-label">Risk of Ruin</div>
              <div className="bai-ror-value" style={{ color: rorColor }}>
                {calc.ror.toFixed(1)}%
              </div>
            </div>

            {/* Recommended stake */}
            <div className="bai-result-row">
              <span className="bai-result-key">Recommended Stake</span>
              <span className="bai-result-val">
                NL{calc.recBB}
                {calc.direction === 'above' && <span className="bai-dir bai-dir--up"> ▲</span>}
                {calc.direction === 'below' && <span className="bai-dir bai-dir--down"> ▼</span>}
                {calc.direction === 'at'    && <span className="bai-dir bai-dir--ok"> ●</span>}
              </span>
            </div>

            {/* Move-up threshold + progress */}
            <div className="bai-threshold-block">
              <div className="bai-result-row">
                <span className="bai-result-key">Move Up At</span>
                <span className="bai-result-val bai-val--green">{fmt(calc.moveUpAt)} chips</span>
              </div>
              <ProgressBar value={Number(bankroll)} max={calc.moveUpAt} />
            </div>

            {/* Move-down threshold */}
            <div className="bai-result-row">
              <span className="bai-result-key">Move Down At</span>
              <span className="bai-result-val bai-val--red">{fmt(calc.moveDownAt)} chips</span>
            </div>

            {/* Sessions to move up */}
            <div className="bai-result-row">
              <span className="bai-result-key">Sessions to Move Up</span>
              <span className="bai-result-val">
                {calc.sessionsToMoveUp === Infinity ? '—' : `${calc.sessionsToMoveUp} sessions`}
              </span>
            </div>

            {/* Kelly fraction */}
            <div className="bai-result-row">
              <span className="bai-result-key">Kelly Bet Size</span>
              <span className="bai-result-val">
                {(calc.kellyFraction * 100).toFixed(2)}% per buy-in
              </span>
            </div>

            {/* Divider */}
            <div className="bai-divider" />

            {/* Advice */}
            <div className="bai-advice">
              {calc.adviceLines.map((line, i) => (
                <p key={i} className="bai-advice-line">▸ {line}</p>
              ))}
            </div>

            {/* Stake progression chart */}
            <div className="bai-chart-wrapper">
              <div className="bai-section-title bai-section-title--chart">
                Stake Progression Chart
              </div>
              <StakeChart bankroll={Number(bankroll)} tolerance={tolerance} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
