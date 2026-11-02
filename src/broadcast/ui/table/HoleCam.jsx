/**
 * HoleCam — the big-cards strip under the broadcast table (lead spec C2,
 * 2026-11-02). It draws ONLY what holeCardGate decided (`gate`), through
 * model/holeCam.js; it never reads seat.holeCards itself.
 *
 * - Public feed: it appears only at a contested showdown that has ended, with
 *   the hands that were shown (winners first). No win %.
 * - Delayed feed (P5-C2b): every dealt-in seat still in the hand. Faces only
 *   when the gate allows them: feed.mode 'delayed', feed.holeCards on, and the
 *   frame MARKS that hand's cards as released (`holeCardsReleasedAt`, after
 *   the hand ended live and the delay passed). Anything else is card BACKS
 *   with 'Cards after the hand' (owner HARD RULE 2026-11-02: never while the
 *   hand is still being played live). Face-up rows lead their hand line with
 *   the deterministic win % from model/equity.js (`equity`), so the 16:9 and
 *   9:16 sources print the same number.
 * - Five or more rows (a delayed hand with many still in) switch to the
 *   compact rows (cards over name), so nine hands fit the strip.
 */
import { memo } from 'react';
import Card2D from '../../../components/scene/Card2D.jsx';
import { broadcastName } from '../../model/broadcastNames.js';
import {
  holeCamRows, holeCamHandName, holeCamEquityText, holeCamCompact, HOLE_CAM_HELD_TEXT,
} from '../../model/holeCam.js';

function HoleCam({ frame, gate, equity = null, layout = '16x9' }) {
  const rows = holeCamRows(frame, gate);
  if (rows.length === 0) return null;
  const compact = holeCamCompact(rows.length);
  return (
    <div
      className={`bc-hole-cam bc-hole-cam--${gate.mode}${compact ? ' bc-hole-cam--compact' : ''}`}
      data-layout={layout}
      data-hand={frame.handNumber}
      data-rows={rows.length}
      data-equity={equity ? equity.street : undefined}
    >
      {rows.map((row) => {
        const { seat, decision, faceUp, winner } = row;
        const hand = faceUp ? holeCamHandName(frame, seat) : HOLE_CAM_HELD_TEXT;
        const pct = holeCamEquityText(equity, gate, row);
        return (
          <div
            key={seat.seatIndex}
            className={`bc-hole-cam__row${winner ? ' bc-hole-cam__row--winner' : ''}${faceUp ? '' : ' bc-hole-cam__row--held'}`}
          >
            <div className="bc-hole-cam__cards">
              {faceUp
                ? decision.cards.map((c, i) => <Card2D key={`f${i}-${c.rank}-${c.suit}`} card={c} faceUp dealDelay={i * 0.08} />)
                : Array.from({ length: decision.backs }, (_, i) => <Card2D key={`b${i}`} card={null} faceUp={false} />)}
            </div>
            <div className="bc-hole-cam__name">{broadcastName(seat, seat.seatIndex)}</div>
            <div className="bc-hole-cam__hand">
              {pct ? <span className="bc-hole-cam__equity">{pct}</span> : null}
              {hand || (winner ? 'Winner' : '')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(HoleCam);
