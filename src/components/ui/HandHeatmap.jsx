import React, { useMemo } from 'react';
import { useThrottle } from '../../hooks/useThrottle';
import './HandHeatmap.css';

// Approximate screen-space positions for a 9-seat table, based on the 3D camera view.
// Values are CSS position strings (percentages of viewport width/height).
const SEAT_OVERLAY_POSITIONS = [
  { bottom: '12%', left:  '50%'  }, // seat 0 — bottom center (hero)
  { bottom: '18%', left:  '28%'  }, // seat 1 — bottom left
  { bottom: '35%', left:  '12%'  }, // seat 2 — left
  { top:    '25%', left:  '15%'  }, // seat 3 — top left
  { top:    '12%', left:  '38%'  }, // seat 4 — top left-center
  { top:    '12%', left:  '55%'  }, // seat 5 — top right-center
  { top:    '25%', right: '15%'  }, // seat 6 — top right
  { bottom: '35%', right: '12%'  }, // seat 7 — right
  { bottom: '18%', right: '28%'  }, // seat 8 — bottom right
];

/**
 * HandHeatmap
 *
 * A training-mode overlay that renders per-seat equity heat indicators as
 * CSS-positioned divs anchored to approximate 3D seat positions.
 *
 * Props:
 *   seats           {Array}   — array of seat objects (index mirrors SEAT_OVERLAY_POSITIONS)
 *   equityResults   {Object}  — map of seatIndex (number|string) → equity % (0-100)
 *   mySeatIndex     {number}  — which seat belongs to the hero
 *   communityCards  {string[]}— current community cards on the board
 *   visible         {boolean} — controlled externally; also gated on postflop (>=3 cards)
 */
export default function HandHeatmap({
  seats: seatsRaw          = [],
  equityResults: equityRaw = {},
  mySeatIndex              = 0,
  communityCards           = [],
  visible                  = false,
}) {
  const seats         = useThrottle(seatsRaw, 500);
  const equityResults = useThrottle(equityRaw, 500);
  // Only show post-flop (3+ community cards) and when explicitly toggled on
  const shouldShow = visible && communityCards.length >= 3;

  const heroEquity = useMemo(
    () => parseFloat(equityResults[mySeatIndex]) || 0,
    [equityResults, mySeatIndex]
  );

  if (!shouldShow) return null;

  return (
    <div className="hh-overlay" aria-hidden="true">
      {SEAT_OVERLAY_POSITIONS.map((posStyle, seatIndex) => {
        const seat = seats[seatIndex];
        // Skip empty seats and the hero's own seat
        if (!seat || !seat.active || seatIndex === mySeatIndex) return null;

        const equity     = parseFloat(equityResults[seatIndex]);
        // If no equity data yet, skip
        if (isNaN(equity)) return null;

        const diff       = equity - heroEquity;          // positive = opponent ahead
        const magnitude  = Math.min(Math.abs(diff) / 100, 1); // 0-1
        const isAhead    = diff > 0;

        // Color: red when opponent is ahead of hero, green when hero is ahead
        const r = isAhead ? 239 : 34;
        const g = isAhead ?  68 : 197;
        const b = isAhead ?  68 :  94;

        const glowOpacity  = 0.15 + magnitude * 0.55; // 0.15 – 0.70
        const labelOpacity = 0.7  + magnitude * 0.3;  // 0.70 – 1.00

        const style = {
          ...posStyle,
          '--hh-r': r,
          '--hh-g': g,
          '--hh-b': b,
          '--hh-glow-opacity': glowOpacity.toFixed(3),
          '--hh-label-opacity': labelOpacity.toFixed(3),
        };

        return (
          <div
            key={seatIndex}
            className="hh-seat-indicator"
            style={style}
            data-seat={seatIndex}
          >
            <div className="hh-disc" />
            <span className="hh-equity-label">{Math.round(equity)}%</span>
            <div className="hh-tooltip">
              Seat {seatIndex} — est. equity vs hero
              <br />
              <span style={{ color: isAhead ? '#f87171' : '#4ade80' }}>
                {isAhead ? '▲' : '▼'} {Math.abs(Math.round(diff))}% {isAhead ? 'ahead' : 'behind'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
