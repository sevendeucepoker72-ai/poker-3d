import React, { useState, useMemo } from 'react';
import './RangeVisualizer.css';

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

// Hand strength categories
// Each entry: [handKey, category]
// category: 0=fold, 1=marginal, 2=playable, 3=strong, 4=premium
const HAND_CATEGORIES = {
  // Premium
  AA: 4, KK: 4, QQ: 4, JJ: 4, TT: 4,
  AKs: 4, AKo: 4, AQs: 4,
  // Strong
  '99': 3, '88': 3, '77': 3,
  AJs: 3, ATs: 3, AQo: 3,
  KQs: 3, KJs: 3, QJs: 3, JTs: 3,
  // Playable
  '66': 2, '55': 2, '44': 2, '33': 2, '22': 2,
  A9s: 2, A8s: 2, A7s: 2, A6s: 2, A5s: 2, A4s: 2, A3s: 2, A2s: 2,
  KQo: 2, KTs: 2, QTs: 2, T9s: 2, '98s': 2, '87s': 2, '76s': 2, '65s': 2,
  // Marginal
  Q9s: 1, J9s: 1, T8s: 1, '97s': 1,
  A8o: 1, A7o: 1, A6o: 1, A5o: 1,
  KJo: 1, QJo: 1, KTo: 1,
};

// Rank index for numeric comparison
const RANK_IDX = {};
RANKS.forEach((r, i) => { RANK_IDX[r] = i; });

function getCellLabel(rowRank, colRank) {
  const ri = RANK_IDX[rowRank];
  const ci = RANK_IDX[colRank];
  if (ri === ci) return `${rowRank}${rowRank}`; // pair
  if (ci < ri) {
    // upper-right: suited (col has higher rank)
    const hi = RANKS[ci];
    const lo = RANKS[ri];
    return `${hi}${lo}s`;
  }
  // lower-left: offsuit (row has higher rank)
  const hi = RANKS[ri];
  const lo = RANKS[ci];
  return `${hi}${lo}o`;
}

function getCategory(label) {
  if (label in HAND_CATEGORIES) return HAND_CATEGORIES[label];
  return 0;
}

const CATEGORY_COLORS = {
  4: '#22C55E',          // premium - bright green
  3: 'rgba(74,222,128,0.5)',  // strong - green 50%
  2: 'rgba(245,158,11,0.5)',  // playable - yellow 50%
  1: 'rgba(249,115,22,0.25)', // marginal - orange 25%
  0: 'rgba(255,255,255,0.04)',// fold
};

const CATEGORY_NAMES = {
  4: 'Premium',
  3: 'Strong',
  2: 'Playable',
  1: 'Marginal',
  0: 'Fold',
};

// Aggression level -> top % of hands shown as opponent range
const AGGRESSION_PCT = { 0: 0.15, 1: 0.30, 2: 0.50, 3: 0.70 };

// Build sorted hand list by strength (category desc, then arbitrary order)
// We'll use category as the strength proxy
function buildSortedHands() {
  const hands = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const label = getCellLabel(RANKS[r], RANKS[c]);
      const cat = getCategory(label);
      hands.push({ label, cat, row: r, col: c });
    }
  }
  // Sort descending by category
  hands.sort((a, b) => b.cat - a.cat);
  return hands;
}

const ALL_HANDS_SORTED = buildSortedHands();
const TOTAL_HANDS = ALL_HANDS_SORTED.length; // 169

function buildOpponentSet(aggressionLevel) {
  const pct = AGGRESSION_PCT[aggressionLevel] ?? 0.30;
  const count = Math.round(TOTAL_HANDS * pct);
  const set = new Set();
  for (let i = 0; i < count; i++) {
    set.add(ALL_HANDS_SORTED[i].label);
  }
  return set;
}

const RANK_NUM_TO_CHAR = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
function parseHoleCards(holeCards) {
  // holeCards: ['Ah', 'Kd'] strings OR [{rank, suit}] objects
  if (!holeCards || holeCards.length < 2) return null;
  const rankChar = (card) => {
    if (typeof card === 'string') return card[0].toUpperCase();
    const r = card?.rank;
    return (RANK_NUM_TO_CHAR[r] ?? String(r ?? '')).toUpperCase();
  };
  const suitChar = (card) => {
    if (typeof card === 'string') return card[1]?.toLowerCase() ?? '';
    return card?.suit?.[0]?.toLowerCase() ?? '';
  };
  const r1 = rankChar(holeCards[0]);
  const r2 = rankChar(holeCards[1]);
  const s1 = suitChar(holeCards[0]);
  const s2 = suitChar(holeCards[1]);
  if (!RANK_IDX.hasOwnProperty(r1) || !RANK_IDX.hasOwnProperty(r2)) return null;
  const i1 = RANK_IDX[r1];
  const i2 = RANK_IDX[r2];
  if (i1 === i2) {
    // pair: row === col
    return { row: i1, col: i2, label: `${r1}${r2}` };
  }
  const suited = s1 === s2;
  const hiIdx = Math.min(i1, i2);
  const loIdx = Math.max(i1, i2);
  const hiRank = RANKS[hiIdx];
  const loRank = RANKS[loIdx];
  const label = suited ? `${hiRank}${loRank}s` : `${hiRank}${loRank}o`;
  if (suited) {
    // upper-right: col < row -> col=hiIdx, row=loIdx
    return { row: loIdx, col: hiIdx, label };
  } else {
    // lower-left: row < col -> row=hiIdx, col=loIdx
    return { row: hiIdx, col: loIdx, label };
  }
}

export default function RangeVisualizer({
  holeCards,
  equity,
  potOdds,
  aggressionLevel = 1,
  visible,
  onClose,
}) {
  const [minimized, setMinimized] = useState(false);
  const [tooltip, setTooltip] = useState(null); // { label, cat, x, y }

  const opponentSet = useMemo(
    () => buildOpponentSet(aggressionLevel),
    [aggressionLevel]
  );

  const heroCell = useMemo(() => parseHoleCards(holeCards), [holeCards]);

  if (!visible) return null;

  const equityColor =
    equity >= 60 ? '#22C55E' : equity >= 40 ? '#F59E0B' : '#EF4444';

  const handleMouseEnter = (e, label, cat) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, cat, x: rect.left, y: rect.top });
  };

  const handleMouseLeave = () => setTooltip(null);

  return (
    <div className="range-visualizer">
      {/* Header */}
      <div className="rv-header">
        <span className="rv-title">RANGE MATRIX</span>
        <div className="rv-controls">
          <button
            className="rv-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '+' : '−'}
          </button>
          <button className="rv-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="rv-body">
          {/* Column rank labels */}
          <div className="rv-grid-wrapper">
            <div className="rv-col-labels">
              <div className="rv-corner" />
              {RANKS.map((r) => (
                <div key={r} className="rv-rank-label">
                  {r}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            <div className="rv-rows">
              {RANKS.map((rowRank, ri) => (
                <div key={rowRank} className="rv-row">
                  {/* Row rank label */}
                  <div className="rv-rank-label rv-row-label">{rowRank}</div>

                  {RANKS.map((colRank, ci) => {
                    const label = getCellLabel(rowRank, colRank);
                    const cat = getCategory(label);
                    const isOpponent = opponentSet.has(label);
                    const isHero =
                      heroCell &&
                      heroCell.row === ri &&
                      heroCell.col === ci;

                    return (
                      <div
                        key={colRank}
                        className={`rv-cell${isHero ? ' rv-hero-cell' : ''}`}
                        style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                        onMouseEnter={(e) => handleMouseEnter(e, label, cat)}
                        onMouseLeave={handleMouseLeave}
                      >
                        {isOpponent && (
                          <div className="rv-opponent-tint" />
                        )}
                        <span className="rv-cell-label">{label}</span>
                        {/* Inline tooltip via CSS :hover — see CSS */}
                        <div className="rv-tooltip">
                          <strong>{label}</strong>
                          <br />
                          {CATEGORY_NAMES[cat]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="rv-stats">
            <span style={{ color: equityColor }}>
              Equity: {equity != null ? equity : '—'}%
            </span>
            <span className="rv-pot-odds">
              Pot odds: {potOdds != null ? potOdds : '—'}%
            </span>
          </div>

          {/* Legend */}
          <div className="rv-legend">
            {[4, 3, 2, 0].map((cat) => (
              <div key={cat} className="rv-legend-item">
                <div
                  className="rv-legend-swatch"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                />
                <span>{CATEGORY_NAMES[cat]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
