/**
 * WinnerFx — the gold winner line when the pot is awarded (lead spec C2,
 * 2026-11-02): 'J. S. wins 12,400 with a Full House'. The winner's seat glows
 * gold (SeatPlate). Gold, never red.
 */
import { memo } from 'react';
import { winnerLines } from '../../model/tableFormat.js';

function WinnerFx({ frame }) {
  const lines = winnerLines(frame);
  if (lines.length === 0) return null;
  return (
    <div className="bc-winner-fx" key={`w${frame.handNumber}`}>
      {lines.map((line, i) => <div key={i} className="bc-winner-fx__line">{line}</div>)}
    </div>
  );
}

export default memo(WinnerFx);
