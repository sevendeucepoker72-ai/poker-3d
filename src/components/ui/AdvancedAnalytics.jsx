import { useState, useEffect, useMemo } from 'react';
import { useDetailedStats } from '../../hooks/useDetailedStats';
import { serverWinRate, useProgressStore } from '../../store/progressStore';
import { summarizeOwnHands, recordToPokerStarsText } from '../../utils/handLog';
import './AdvancedAnalytics.css';

// 2026-10-11 (.online R2 — APPUI-51 / C10). Everything here is the player's
// OWN data: his rows of the lobby hand log (utils/handLog — his seat in each
// hand; other players' rows are never counted), the server's playerProgress
// counters, and the server's tracked stats (getDetailedStats). It used to sum
// EVERY player's chip delta (always ~0), count every winner as his win, and
// grade leaks from this browser's own counters. A number the server does not
// track is shown as "not tracked", never invented.

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
  const map = { A: '#4ADE80', B: '#86EFAC', C: '#FDE68A', D: '#FBBF24', E: '#93C5FD', F: '#60A5FA', 'N/A': '#8fa8d8' };
  return map[grade] || '#8fa8d8';
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

function OverviewTab({ progress, summary }) {
  const cards = [
    { label: 'Win Rate (all hands)', value: `${serverWinRate(progress)}%` },
    { label: 'Hands Played (all)', value: (Number(progress?.totalHandsPlayed) || 0).toLocaleString() },
    { label: `Recent Hands Logged`, value: summary.hands },
    { label: 'Won (recent)', value: `${summary.wins} (${fmt(summary.winRate)}%)` },
    { label: 'Net (recent)', value: summary.netKnown > 0 ? fmtChips(summary.net) : '—' },
    { label: 'Avg Pot Won (recent)', value: summary.wins > 0 ? `${summary.avgPotWon.toLocaleString()} chips` : '—' },
    { label: 'Best Win (recent)', value: summary.biggestWin > 0 ? `${summary.biggestWin.toLocaleString()}${summary.bestHandName ? ` · ${summary.bestHandName}` : ''}` : '—' },
    { label: 'ELO', value: progress?.elo ?? '—' },
    { label: 'Level', value: progress?.level ?? '—' },
  ];

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Performance Overview</h3>
      <p className="aa-section-sub">"Recent" = your hands in the history the server keeps for you (up to 100) plus this session.</p>
      <div className="aa-stats-grid">
        {cards.map(c => (
          <div key={c.label} className="aa-stat-card">
            <span className="aa-stat-label">{c.label}</span>
            <span className="aa-stat-value">{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leaks tab (server-tracked stats only) ────────────────────────────────────

function LeaksTab({ detailed, status }) {
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const tracked = Number(detailed?.handsTracked ?? detailed?.totalHandsPlayed) || 0;
  const enough = tracked >= 20;
  const vpip = enough ? num(detailed?.vpip) : null;
  const pfr = enough ? num(detailed?.pfr) : null;
  const afRaw = enough ? num(detailed?.af) : null;
  const af = afRaw != null && afRaw < 99 ? afRaw : null;
  const handsWon = Number(detailed?.handsWon) || 0;
  const bluffPct = enough && handsWon >= 5 && num(detailed?.bluffWins) != null ? Math.round((Number(detailed.bluffWins) / handsWon) * 100) : null;

  if (status !== 'ready') {
    return (
      <div className="aa-section">
        <h3 className="aa-section-title">Leak Finder</h3>
        <p className="aa-empty">{status === 'loading' ? 'Loading your tracked stats from the server…' : 'Your tracked stats are not available right now — try again in a moment.'}</p>
      </div>
    );
  }

  const leaks = [
    {
      name: 'VPIP (voluntarily put chips in the pot)', value: vpip, threshold: 35, unit: '%', higherIsBad: true,
      advice: vpip == null ? 'Not enough tracked hands yet.' : vpip > 35
        ? 'You are playing too many hands pre-flop. Tighten your opening ranges, especially in early position.'
        : 'Good range discipline. Keep selective aggression in late position.',
    },
    {
      name: 'PFR (pre-flop raise %)', value: pfr, threshold: 12, unit: '%', higherIsBad: false,
      advice: pfr == null ? 'Not enough tracked hands yet.' : pfr < 12
        ? 'You are limping too often. Open-raise or fold — target a PFR of 15-22%.'
        : 'Solid pre-flop aggression.',
    },
    {
      name: 'Aggression Factor', value: af, threshold: 1.5, unit: '', higherIsBad: false,
      advice: af == null ? 'Not enough calls tracked yet.' : af < 1.5
        ? 'You call more than you bet or raise. Bet your strong hands and draws instead of check-calling.'
        : 'Good aggression. Make sure you are not over-bluffing river spots.',
    },
    {
      name: 'Bluff wins (of hands won)', value: bluffPct, threshold: 40, unit: '%', higherIsBad: true,
      advice: bluffPct == null ? 'Not enough wins tracked yet.' : bluffPct > 40
        ? 'A lot of your wins come without a pair — keep bluffs to good spots.'
        : 'Balanced bluffing frequency.',
    },
  ].map((l) => ({ ...l, grade: gradeFromRatio(l.value, l.threshold, l.higherIsBad) }));

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Leak Finder</h3>
      <p className="aa-section-sub">From the server's tracked stats ({tracked.toLocaleString()} hands). Fold-to-steal is not tracked yet.</p>
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

// ── Results chart (his own net per hand) ─────────────────────────────────────

function SessionsTab({ summary }) {
  const points = summary.series.map((s) => ({ x: s.n, y: s.cumulative }));
  const ys = points.map((p) => p.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);

  const W = 560;
  const H = 220;
  const PAD = { top: 20, right: 20, bottom: 30, left: 55 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const yRange = maxY - minY || 1;
  const xMin = points.length ? points[0].x : 1;
  const xRange = (points.length ? points[points.length - 1].x - xMin : 0) || 1;
  const toSVG = (pt) => ({
    x: PAD.left + ((pt.x - xMin) / xRange) * chartW,
    y: PAD.top + (1 - (pt.y - minY) / yRange) * chartH,
  });
  const svgPoints = points.map(toSVG);
  const pathD = svgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const zeroY = PAD.top + (1 - (0 - minY) / yRange) * chartH;
  const areaD = svgPoints.length > 1
    ? `${pathD} L${svgPoints[svgPoints.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${svgPoints[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`
    : '';
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => minY + (yRange / yTicks) * i);
  const final = points.length ? points[points.length - 1].y : 0;

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Results Chart</h3>
      <p className="aa-section-sub">Your chips won or lost per hand, added up (your recent hands).</p>
      {points.length < 2 ? (
        <p className="aa-empty">Play a few more hands to see your results chart.</p>
      ) : (
        <div className="aa-chart-wrap">
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="aa-svg-chart">
            <defs>
              <linearGradient id="aaChartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffd24a" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#ffd24a" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {yTickValues.map((v, i) => {
              const sy = PAD.top + (1 - (v - minY) / yRange) * chartH;
              return (
                <g key={i}>
                  <line x1={PAD.left} y1={sy} x2={PAD.left + chartW} y2={sy} stroke="#1a2a44" strokeWidth="1" />
                  <text x={PAD.left - 6} y={sy + 4} fill="#6688aa" fontSize="9" textAnchor="end">
                    {Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}
                  </text>
                </g>
              );
            })}
            <line x1={PAD.left} y1={zeroY} x2={PAD.left + chartW} y2={zeroY} stroke="#334466" strokeWidth="1.5" strokeDasharray="4,3" />
            {areaD && <path d={areaD} fill="url(#aaChartGrad)" />}
            {pathD && <path d={pathD} fill="none" stroke="#ffd24a" strokeWidth="2" strokeLinejoin="round" />}
            {svgPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="#ffd24a" opacity="0.7" />)}
            <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="#334" strokeWidth="1" />
            <line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="#334" strokeWidth="1" />
            <text x={PAD.left + chartW / 2} y={H - 4} fill="#4466aa" fontSize="9" textAnchor="middle">Your hands (oldest → newest)</text>
          </svg>
        </div>
      )}
      <div className="aa-sessions-summary">
        <span>Hands: <strong>{points.length}</strong></span>
        <span>Peak: <strong>{fmtChips(maxY)}</strong></span>
        <span>Lowest: <strong style={{ color: minY < 0 ? '#93C5FD' : '#4ADE80' }}>{fmtChips(minY)}</strong></span>
        <span>Total: <strong style={{ color: final >= 0 ? '#4ADE80' : '#93C5FD' }}>{fmtChips(final)}</strong></span>
      </div>
      {(summary.tournaments.count > 0 || summary.tournamentHands > 0) && (
        <p className="aa-section-sub aa-tournament-note">
          {summary.tournaments.count > 0
            ? `Tournaments: ${summary.tournaments.count} · prizes +${summary.tournaments.prizes.toLocaleString()} · entries -${summary.tournaments.fees.toLocaleString()}`
            : `${summary.tournamentHands} tournament hands left out - tournament chips are not your bankroll`}
        </p>
      )}
    </div>
  );
}

// ── Export tab (his own seat, play-money chips) ──────────────────────────────

function ExportTab({ handLog, myName }) {
  const [count, setCount] = useState(20);
  const [exported, setExported] = useState(false);
  const own = useMemo(() => handLog.map((h) => ({ h, txt: recordToPokerStarsText(h, myName) })).filter((x) => x.txt), [handLog, myName]);

  function handleExport() {
    const n = Math.max(1, Math.min(own.length, Number(count) || 1));
    const content = own.slice(-n).map((x) => x.txt).join('\n\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `american_pub_poker_hands_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }

  return (
    <div className="aa-section">
      <h3 className="aa-section-title">Export Hand History</h3>
      <p className="aa-section-sub">Your hands in PokerStars-style text (amounts are play-money chips), from your seat. The Hand History Importer reads this file back.</p>
      <div className="aa-export-controls">
        <label className="aa-label">
          Hands to export
          <input
            type="number"
            className="aa-input"
            min={1}
            max={Math.max(1, own.length)}
            value={count}
            onChange={e => setCount(Number(e.target.value))}
          />
        </label>
        <span className="aa-export-info">{Math.min(count, own.length)} / {own.length} of your hands selected</span>
      </div>
      <div className="aa-export-preview">
        <span className="aa-export-preview-label">Preview (latest hand):</span>
        <pre className="aa-export-pre">
          {own.length > 0 ? own[own.length - 1].txt : 'No hands of yours recorded yet.'}
        </pre>
      </div>
      <button
        className={`aa-btn-primary ${exported ? 'aa-btn-success' : ''}`}
        onClick={handleExport}
        disabled={own.length === 0}
      >
        {exported ? 'Downloaded!' : 'Download Hand History (.txt)'}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Leaks', 'Results', 'Export'];

export default function AdvancedAnalytics({ progress, handLog = [], myName = '', onClose }) {
  const [activeTab, setActiveTab] = useState('Overview');
  // loading | ready | unavailable (a still-loading record is asked again, never graded as zeros)
  const { stats: detailed, status } = useDetailedStats();
  // Sit & Go fix-all C2 — wallet results only: tournament hands are counted,
  // never added to the chips won / lost; tournament prizes are shown instead.
  const tournamentResults = useProgressStore((s) => s.tournamentResults);
  const tournamentTableIds = useProgressStore((s) => s.tournamentTableIds);
  const summary = useMemo(
    () => summarizeOwnHands(handLog, myName, { tournamentResults, tournamentTableIds }),
    [handLog, myName, tournamentResults, tournamentTableIds],
  );

  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const xp = Number(progress?.xp) || 0;
  const xpNext = Number(progress?.xpToNextLevel) || 0;

  return (
    <div className="aa-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="aa-modal" role="dialog" aria-label="Advanced analytics">
        <div className="aa-header">
          <div className="aa-header-left">
            <span className="aa-icon">◈</span>
            <h2 className="aa-title">Advanced Analytics</h2>
            {progress?.rank && <span className="aa-badge">{progress.rank}</span>}
          </div>
          <button className="aa-close-btn" onClick={onClose}>✕</button>
        </div>

        {progress && (
          <div className="aa-progress-bar-wrap">
            <div className="aa-progress-meta">
              <span>Level {progress.level}</span>
              <span>{xp.toLocaleString()} / {xpNext > 0 ? xpNext.toLocaleString() : '—'} XP</span>
              <span>{(progress.chips ?? 0).toLocaleString()} chips</span>
            </div>
            <div className="aa-progress-track">
              <div className="aa-progress-fill" style={{ width: `${xpNext > 0 ? Math.min(100, (xp / xpNext) * 100) : 0}%` }} />
            </div>
          </div>
        )}

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

        <div className="aa-content">
          {activeTab === 'Overview' && <OverviewTab progress={progress} summary={summary} />}
          {activeTab === 'Leaks' && <LeaksTab detailed={detailed} status={status} />}
          {activeTab === 'Results' && <SessionsTab summary={summary} />}
          {activeTab === 'Export' && <ExportTab handLog={handLog} myName={myName} />}
        </div>
      </div>
    </div>
  );
}
