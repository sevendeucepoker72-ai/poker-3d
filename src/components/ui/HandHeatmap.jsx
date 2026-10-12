import React, { useMemo, useLayoutEffect, useState } from 'react';
import { useThrottle } from '../../hooks/useThrottle';
import './HandHeatmap.css';

// R1 (TABLEUI-3, 2026-10-11) — each disc sits on its seat's avatar on the 2D
// table (PokerTable2D marks every seat pod with data-seat-index; the table is
// rotated so the hero sits at the bottom, so a fixed per-index position put a
// disc on the wrong seat). The fixed positions below are only the fallback
// when a seat pod can't be measured.
function measureSeatAnchors() {
  const out = {};
  if (typeof document === 'undefined') return out;
  document.querySelectorAll('.seat-pod[data-seat-index]').forEach((el) => {
    const i = Number(el.getAttribute('data-seat-index'));
    if (!Number.isInteger(i)) return;
    const box = (el.querySelector('.seat-pod__avatar-wrap') || el).getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      out[i] = { left: `${Math.round(box.left + box.width / 2)}px`, top: `${Math.round(box.top + box.height / 2)}px` };
    }
  });
  return out;
}
const sameAnchors = (a, b) => {
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] && a[k].left === b[k].left && a[k].top === b[k].top);
};

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

  // R1 — where each seat actually is on screen (re-measured as seats change).
  const [anchors, setAnchors] = useState({});
  useLayoutEffect(() => {
    if (!shouldShow) return undefined;
    const measure = () => {
      const next = measureSeatAnchors();
      setAnchors((prev) => (sameAnchors(prev, next) ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shouldShow, seats]);

  if (!shouldShow) return null;

  return (
    <div className="hh-overlay" aria-hidden="true">
      {SEAT_OVERLAY_POSITIONS.map((fallbackPos, seatIndex) => {
        const seat = seats[seatIndex];
        // Skip empty / folded seats and the hero's own seat.
        // R1 (TABLEUI-3) — the server never sends `seat.active`, so the old
        // `!seat.active` filter skipped EVERY seat and the heatmap drew nothing.
        if (!seat || seat.state !== 'occupied' || seat.folded || seatIndex === mySeatIndex) return null;
        const posStyle = anchors[seatIndex] || fallbackPos;

        const equity     = parseFloat(equityResults[seatIndex]);
        // If no equity data yet, skip
        if (isNaN(equity)) return null;

        const diff       = equity - heroEquity;          // positive = opponent ahead
        const magnitude  = Math.min(Math.abs(diff) / 100, 1); // 0-1
        const isAhead    = diff > 0;

        // Color: amber when opponent is ahead of hero, green when hero is ahead
        // (R3 review CLIENT-2 — owner rule "no red, use blue": was #ef4444).
        const r = isAhead ? 245 : 34;
        const g = isAhead ? 158 : 197;
        const b = isAhead ?  11 :  94;

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
              <span style={{ color: isAhead ? '#fbbf24' : '#4ade80' }}>
                {isAhead ? '▲' : '▼'} {Math.abs(Math.round(diff))}% {isAhead ? 'ahead' : 'behind'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
