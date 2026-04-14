import React, { useState, useEffect, useMemo } from 'react';
import './AdvancedAnalytics.css';

// ── helpers ──────────────────────────────────────────────────────────────────

function gradeFromRatio(value, threshold, higherIsBad) {
  if (value == null || isNaN(value)) return 'N/A';
  const ratio = higherIsBad ? value / threshold : threshold / value;
  if (ratio <= 0.6) return 'A';
  if (ratio <= 0.8) return 'B';
  if (ratio <= 1.0) return 'C';
  if (ratio <= 1.2) return 'D';
  if (ratio <= 1.5) return 'E';
  return 'F';
}

function gradeColor(grade) {
  const map = { A: '#00FF88', B: '#88FF00', C: '#FFFF00', D: '#FF8800', E: '#FF4400', F: '#FF0000', 'N/A': '#888' };
  return map[grade] || '#888';
}

function fmt(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function fmtChips(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${n >= 0 ? '+' : ''}${n}`;
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ progress, handHistories }) {
  const stats = useMemo(() => {
    const totalHands = handHistories.length;

    let netChips = 0;
    let totalPotWon = 0;
    let winCount = 0;
    let bestHandName = '—';
    let bestChipsWon = 0;

    handHistories.forEach(h => {
      h.winners?.forEach(w => {
        if (w.chipsWon > bestChipsWon) {
          bestChipsWon = w.chipsWon;
          bestHandName = w.handName || '—';
        }
        totalPotWon += w.chipsWon;
        winCount++;
      });
      h.players?.forEach(p => {
        if (p.endChips != null && p.startChips != null) {
          netChips += p.endChips - p.startChips;
        }
      });
    });

    const avgPotWon = winCount > 0 ? totalPotWon / winCount : 0;
    const winRate = progress?.winRate ?? (totalHands > 0 ? (winCount / totalHands) * 100 : 0);

    return { totalHands, netChips, avgPotWon, winRate, bestHandName };
  }, [handHistories, progress]);

  const cards = [
    { label: 'Total Hands', value: stats.totalHands, unit: '' },
    { label: 'Win Rate', value: fmt(stats.winRate), unit: '%' },
    { label: 'Net Chips', value: fmtChips(stats.netChips), unit: '' },
    { label: 'Avg Pot Won', value: fmt(stats.avgPotWon, 0), unit: ' chips' },
    { label: 'Best Hand', value: stats.bestHandName, unit: '' },
    { label: 'ELO', value: progress?.elo ?? '—', unit: '' },
    { label: 'Rank', value: progress?.rank ?? '—', unit: '' },
    { label: 'Level', value: progress?.level ?? '—', unit: '' },
  ];

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Performance Overview</h3>
      <div className="aa-stats-grid">
        {cards.map(c => (
          <div key={c.label} className="aa-stat-card">
            <span className="aa-stat-label">{c.label}</span>
            <span className="aa-stat-value">{c.value}{c.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leaks tab ─────────────────────────────────────────────────────────────────

function LeaksTab({ progress }) {
  const vpip = (progress?.vpip != null && progress.vpip > 0) ? progress.vpip : null;
  const pfr = (progress?.pfr != null && progress.pfr > 0) ? progress.pfr : null;

  // Aggression factor from street action counts: (bets+raises) / calls
  const aggFactor = useMemo(() => {
    const sa = progress?.streetActions;
    if (!sa) return null;
    let bets = 0, raises = 0, calls = 0;
    for (const s of Object.values(sa)) {
      bets += s.bets || 0;
      raises += s.raises || 0;
      calls += s.calls || 0;
    }
    if (calls === 0) return bets + raises > 0 ? 999 : null;
    return +((bets + raises) / calls).toFixed(1);
  }, [progress]);

  // Bluff %, computed from bluffWins / handsWon
  const bluffPct = useMemo(() => {
    const hw = progress?.handsWon;
    const bw = progress?.bluffWins;
    if (!hw || hw < 5) return null;
    return Math.round(((bw || 0) / hw) * 100);
  }, [progress]);

  // Fold to steal, computed from blind fold tracking
  const foldToSteal = useMemo(() => {
    const bh = progress?.blindHands;
    const bf = progress?.blindFolded;
    if (!bh || bh < 10) return null;
    return Math.round(((bf || 0) / bh) * 100);
  }, [progress]);

  const leaks = [
    {
      name: 'VPIP (Voluntarily Put $ In Pot)',
      value: vpip,
      threshold: 35,
      unit: '%',
      higherIsBad: true,
      grade: gradeFromRatio(vpip, 35, true),
      advice: vpip == null
        ? 'No data yet. Play more hands to generate stats.'
        : vpip > 35
          ? 'You are playing too many hands pre-flop. Tighten your opening ranges, especially in early position. Fold suited connectors and weak aces from UTG/UTG+1.'
          : 'Good range discipline. Maintain selective aggression in late position.',
    },
    {
      name: 'PFR (Pre-Flop Raise %)',
      value: pfr,
      threshold: 12,
      unit: '%',
      higherIsBad: false,
      grade: gradeFromRatio(pfr, 12, false),
      advice: pfr == null
        ? 'No data yet.'
        : pfr < 12
          ? 'You are limping too often. Open-raise or fold — limping leaks chips and gives opponents cheap flops. Target PFR of 15-22% for a balanced TAG style.'
          : 'Solid pre-flop aggression. Ensure your 3-bet range is balanced.',
    },
    {
      name: 'Aggression Factor',
      value: aggFactor,
      threshold: 1.5,
      unit: '',
      higherIsBad: false,
      grade: gradeFromRatio(aggFactor, 1.5, false),
      advice: aggFactor == null
        ? 'No data yet.'
        : aggFactor < 1.5
          ? 'You are calling too passively. Replace cold-calls with 3-bets or folds. On the flop, bet your strong hands and draws instead of check-calling.'
          : 'Good aggression. Ensure you are not over-bluffing on river spots.',
    },
    {
      name: 'Bluff % (of all hands)',
      value: bluffPct,
      threshold: 40,
      unit: '%',
      higherIsBad: true,
      grade: gradeFromRatio(bluffPct, 40, true),
      advice: bluffPct == null
        ? 'No data yet.'
        : bluffPct > 40
          ? 'You are over-bluffing. Bluffs should be polarized to strong draws or blockers. Reduce river bluffs vs calling stations and nit regulars.'
          : 'Balanced bluffing frequency. Keep villain tendencies in mind when choosing bluff candidates.',
    },
    {
      name: 'Fold to Steal %',
      value: foldToSteal,
      threshold: 75,
      unit: '%',
      higherIsBad: true,
      grade: gradeFromRatio(foldToSteal, 75, true),
      advice: foldToSteal == null
        ? 'No data yet.'
        : foldToSteal > 75
          ? 'You are over-folding in the blinds. Defend with suited connectors, medium pairs, and broadway hands. Re-steal with 3-bets against loose openers.'
          : 'Good blind defense. Continue adjusting based on the open-raiser\'s position and tendencies.',
    },
  ];

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Leak Finder</h3>
      <p className="aa-section-sub">Stats sourced from your tracked play history.</p>
      <div className="aa-leaks-list">
        {leaks.map(leak => (
          <div key={leak.name} className="aa-leak-card">
            <div className="aa-leak-header">
              <span className="aa-leak-name">{leak.name}</span>
              <span className="aa-leak-grade" style={{ color: gradeColor(leak.grade), borderColor: gradeColor(leak.grade) }}>
                {leak.grade}
              </span>
            </div>
            <div className="aa-leak-meta">
              <span className="aa-leak-current">
                Current: <strong>{leak.value != null ? `${fmt(leak.value, 1)}${leak.unit}` : 'N/A'}</strong>
              </span>
              <span className="aa-leak-threshold">
                Threshold: <strong>{leak.threshold}{leak.unit}</strong>
              </span>
            </div>
            <div className="aa-grade-bar-wrap">
              <div
                className="aa-grade-bar-fill"
                style={{
                  width: leak.value != null
                    ? `${Math.min(100, (leak.higherIsBad ? leak.value / (leak.threshold * 1.5) : Math.min(leak.value, leak.threshold * 1.5) / (leak.threshold * 1.5)) * 100)}%`
                    : '0%',
                  background: gradeColor(leak.grade),
                }}
              />
            </div>
            <p className="aa-leak-advice">{leak.advice}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sessions / SVG Chart tab ──────────────────────────────────────────────────

function SessionsTab({ handHistories }) {
  const { points, minY, maxY } = useMemo(() => {
    if (!handHistories || handHistories.length === 0) return { points: [], minY: 0, maxY: 0 };

    let cumulative = 0;
    const pts = handHistories.map((h, i) => {
      let delta = 0;
      h.players?.forEach(p => {
        if (p.endChips != null && p.startChips != null) delta += p.endChips - p.startChips;
      });
      cumulative += delta;
      return { x: i + 1, y: cumulative };
    });

    const ys = pts.map(p => p.y);
    return { points: pts, minY: Math.min(0, ...ys), maxY: Math.max(0, ...ys) };
  }, [handHistories]);

  const W = 560;
  const H = 220;
  const PAD = { top: 20, right: 20, bottom: 30, left: 55 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const yRange = maxY - minY || 1;
  const xRange = points.length - 1 || 1;

  const toSVG = pt => ({
    x: PAD.left + (pt.x - 1) / xRange * chartW,
    y: PAD.top + (1 - (pt.y - minY) / yRange) * chartH,
  });

  const svgPoints = points.map(toSVG);
  const pathD = svgPoints.length > 0
    ? svgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  const zeroY = PAD.top + (1 - (0 - minY) / yRange) * chartH;
  const areaD = svgPoints.length > 1
    ? `${pathD} L${svgPoints[svgPoints.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${svgPoints[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`
    : '';

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => minY + (yRange / yTicks) * i);

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Bankroll Chart</h3>
      {points.length === 0 ? (
        <p className="aa-empty">No hand history data to chart.</p>
      ) : (
        <div className="aa-chart-wrap">
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="aa-svg-chart">
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00D9FF" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#00D9FF" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {yTickValues.map((v, i) => {
              const sy = PAD.top + (1 - (v - minY) / yRange) * chartH;
              return (
                <g key={i}>
                  <line x1={PAD.left} y1={sy} x2={PAD.left + chartW} y2={sy} stroke="#1a2a2a" strokeWidth="1" />
                  <text x={PAD.left - 6} y={sy + 4} fill="#6688aa" fontSize="9" textAnchor="end">
                    {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {/* Zero line */}
            <line x1={PAD.left} y1={zeroY} x2={PAD.left + chartW} y2={zeroY} stroke="#334455" strokeWidth="1.5" strokeDasharray="4,3" />

            {/* Area fill */}
            {areaD && <path d={areaD} fill="url(#chartGrad)" />}

            {/* Line */}
            {pathD && <path d={pathD} fill="none" stroke="#00D9FF" strokeWidth="2" strokeLinejoin="round" />}

            {/* Dots */}
            {svgPoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#00D9FF" opacity="0.7" />
            ))}

            {/* Axes */}
            <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="#334" strokeWidth="1" />
            <line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="#334" strokeWidth="1" />

            {/* X labels */}
            {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 8)) === 0).map((pt, i) => {
              const sx = PAD.left + (pt.x - 1) / xRange * chartW;
              return (
                <text key={i} x={sx} y={H - 8} fill="#6688aa" fontSize="9" textAnchor="middle">#{pt.x}</text>
              );
            })}

            <text x={PAD.left + chartW / 2} y={H - 1} fill="#4466aa" fontSize="9" textAnchor="middle">Hand #</text>
          </svg>
        </div>
      )}
      <div className="aa-sessions-summary">
        <span>Total Hands: <strong>{points.length}</strong></span>
        <span>Peak: <strong>{fmtChips(maxY)}</strong></span>
        <span>Lowest: <strong style={{ color: minY < 0 ? '#FF4444' : '#00FF88' }}>{fmtChips(minY)}</strong></span>
        <span>Final: <strong style={{ color: points[points.length - 1]?.y >= 0 ? '#00FF88' : '#FF4444' }}>
          {fmtChips(points[points.length - 1]?.y ?? 0)}
        </strong></span>
      </div>
    </div>
  );
}

// ── Export tab ────────────────────────────────────────────────────────────────

function ExportTab({ handHistories }) {
  const [count, setCount] = useState(20);
  const [exported, setExported] = useState(false);

  function buildPokerStarsFormat(histories) {
    return histories.slice(-count).map((h, idx) => {
      const handNum = idx + 1;
      let txt = `PokerStars Hand #${handNum}: Hold'em No Limit\n`;
      txt += `Table '${h.tableName || 'Unknown'}' ${h.players?.length || 9}-max Seat #${h.yourSeat ?? 1} is the button\n`;

      h.players?.forEach(p => {
        txt += `Seat ${p.seatIndex + 1}: ${p.name} (${p.startChips ?? 0} chips)\n`;
      });

      txt += `*** HOLE CARDS ***\n`;

      h.players?.forEach(p => {
        if (p.actions && p.actions.length > 0) {
          p.actions.forEach(action => {
            txt += `${p.name}: ${action}\n`;
          });
        }
      });

      if (h.winners && h.winners.length > 0) {
        txt += `*** SHOWDOWN ***\n`;
        h.winners.forEach(w => {
          const player = h.players?.find(p => p.seatIndex === w.seatIndex);
          const name = player?.name ?? `Seat ${w.seatIndex + 1}`;
          txt += `${name} shows [? ?] (${w.handName || 'a hand'})\n`;
          txt += `${name} collected ${w.chipsWon} from pot\n`;
        });
      }

      txt += `*** SUMMARY ***\n`;
      h.players?.forEach(p => {
        const delta = (p.endChips ?? 0) - (p.startChips ?? 0);
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
        txt += `Seat ${p.seatIndex + 1}: ${p.name} (${deltaStr})\n`;
      });

      return txt;
    }).join('\n\n');
  }

  function handleExport() {
    const content = buildPokerStarsFormat(handHistories);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hand_history_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Export Hand History</h3>
      <p className="aa-section-sub">Download hand histories in PokerStars .txt format for use with tracking software.</p>
      <div className="aa-export-controls">
        <label className="aa-label">
          Hands to export
          <input
            type="number"
            className="aa-input"
            min={1}
            max={handHistories.length || 100}
            value={count}
            onChange={e => setCount(Number(e.target.value))}
          />
        </label>
        <span className="aa-export-info">{Math.min(count, handHistories.length)} / {handHistories.length} hands selected</span>
      </div>
      <div className="aa-export-preview">
        <span className="aa-export-preview-label">Preview (first hand):</span>
        <pre className="aa-export-pre">
          {handHistories.length > 0 ? buildPokerStarsFormat(handHistories.slice(-1)) : 'No hand history available.'}
        </pre>
      </div>
      <button
        className={`aa-btn-primary ${exported ? 'aa-btn-success' : ''}`}
        onClick={handleExport}
        disabled={handHistories.length === 0}
      >
        {exported ? 'Downloaded!' : 'Download Hand History (.txt)'}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Leaks', 'Sessions', 'Export'];

export default function AdvancedAnalytics({ progress, handHistories = [], onClose }) {
  const [activeTab, setActiveTab] = useState('Overview');

  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="aa-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="aa-modal">
        {/* Header */}
        <div className="aa-header">
          <div className="aa-header-left">
            <span className="aa-icon">◈</span>
            <h2 className="aa-title">Advanced Analytics</h2>
            {progress?.rank && <span className="aa-badge">{progress.rank}</span>}
          </div>
          <button className="aa-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Progress bar */}
        {progress && (
          <div className="aa-progress-bar-wrap">
            <div className="aa-progress-meta">
              <span>Level {progress.level}</span>
              <span>{progress.xp ?? 0} XP</span>
              <span>{(progress.chips ?? 0).toLocaleString()} chips</span>
            </div>
            <div className="aa-progress-track">
              <div
                className="aa-progress-fill"
                style={{ width: `${Math.min(100, ((progress.xp ?? 0) % 1000) / 10)}%` }}
              />
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="aa-tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`aa-tab-btn ${activeTab === tab ? 'aa-tab-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="aa-content">
          {activeTab === 'Overview' && <OverviewTab progress={progress} handHistories={handHistories} />}
          {activeTab === 'Leaks' && <LeaksTab progress={progress} />}
          {activeTab === 'Sessions' && <SessionsTab handHistories={handHistories} />}
          {activeTab === 'Export' && <ExportTab handHistories={handHistories} />}
        </div>
      </div>
    </div>
  );
}
