import React from 'react';
import { createPortal } from 'react-dom';
import './HandRangeChart.css';

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

// Hand rankings: tier 1 = top 10%, tier 2 = top 25%, tier 3 = top 50%, tier 4 = bottom 50%
// Based on standard preflop hand rankings
const HAND_TIERS = {
  // Tier 1 - Top 10% (premium hands)
  'AA': 1, 'KK': 1, 'QQ': 1, 'JJ': 1, 'TT': 1,
  'AKs': 1, 'AQs': 1, 'AJs': 1, 'ATs': 1,
  'AKo': 1, 'KQs': 1,

  // Tier 2 - Top 25%
  '99': 2, '88': 2, '77': 2,
  'A9s': 2, 'A8s': 2, 'A7s': 2, 'A6s': 2, 'A5s': 2, 'A4s': 2, 'A3s': 2, 'A2s': 2,
  'KJs': 2, 'KTs': 2, 'QJs': 2, 'QTs': 2, 'JTs': 2,
  'AQo': 2, 'AJo': 2, 'ATo': 2, 'KQo': 2,

  // Tier 3 - Top 50%
  '66': 3, '55': 3, '44': 3, '33': 3, '22': 3,
  'K9s': 3, 'K8s': 3, 'K7s': 3, 'K6s': 3, 'K5s': 3,
  'Q9s': 3, 'Q8s': 3, 'J9s': 3, 'J8s': 3, 'T9s': 3, 'T8s': 3,
  '98s': 3, '97s': 3, '87s': 3, '86s': 3, '76s': 3, '75s': 3,
  '65s': 3, '64s': 3, '54s': 3, '53s': 3, '43s': 3,
  'KJo': 3, 'KTo': 3, 'QJo': 3, 'QTo': 3, 'JTo': 3,
  'A9o': 3, 'A8o': 3, 'A7o': 3, 'A6o': 3, 'A5o': 3,
  'K9o': 3, 'T9o': 3, '98o': 3,
};

function getHandName(row, col) {
  if (row === col) {
    // Diagonal = pocket pairs
    return RANKS[row] + RANKS[col];
  } else if (col > row) {
    // Above diagonal = suited
    return RANKS[row] + RANKS[col] + 's';
  } else {
    // Below diagonal = offsuit
    return RANKS[col] + RANKS[row] + 'o';
  }
}

function getDisplayName(row, col) {
  if (row === col) return RANKS[row] + RANKS[col];
  if (col > row) return RANKS[row] + RANKS[col] + 's';
  return RANKS[col] + RANKS[row] + 'o';
}

function getTier(handName) {
  return HAND_TIERS[handName] || 4;
}

export default function HandRangeChart({ onClose }) {
  const legendItems = [
    { tier: 'tier-1', label: 'Top 10% (Premium)', color: '#22C55E' },
    { tier: 'tier-2', label: 'Top 25% (Strong)', color: '#EAB308' },
    { tier: 'tier-3', label: 'Top 50% (Playable)', color: '#F97316' },
    { tier: 'tier-4', label: 'Bottom 50%', color: '#4a4a5e' },
  ];

  return createPortal(
    <div className="range-chart-overlay" onClick={onClose}>
      <div className="range-chart-panel" onClick={(e) => e.stopPropagation()}>
        <div className="range-chart-header">
          <span className="range-chart-title">Starting Hand Range Chart</span>
          <button className="range-chart-close" onClick={onClose}>Close</button>
        </div>

        <div className="range-chart-legend">
          {legendItems.map((item) => (
            <div key={item.tier} className="range-legend-item">
              <div className="range-legend-swatch" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
        </div>

        <div className="range-chart-grid">
          {/* Empty corner cell */}
          <div className="range-chart-grid-header" />
          {/* Column headers */}
          {RANKS.map((r) => (
            <div key={`col-${r}`} className="range-chart-grid-header">{r}</div>
          ))}

          {/* Grid rows */}
          {RANKS.map((rowRank, row) => (
            <React.Fragment key={`row-${rowRank}`}>
              {/* Row header */}
              <div className="range-chart-grid-header">{rowRank}</div>
              {/* Cells */}
              {RANKS.map((colRank, col) => {
                const handName = getHandName(row, col);
                const displayName = getDisplayName(row, col);
                const tier = getTier(handName);
                const isPair = row === col;

                return (
                  <div
                    key={`${row}-${col}`}
                    className={`range-cell tier-${tier} ${isPair ? 'pair' : ''}`}
                    title={`${displayName} - ${tier === 1 ? 'Premium' : tier === 2 ? 'Strong' : tier === 3 ? 'Playable' : 'Marginal'}`}
                  >
                    {displayName}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
