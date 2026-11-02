/**
 * SeatPlate — one seat on the broadcast table (lead spec C2, 2026-11-02).
 * Shows the server-applied name only ('Seat N' when missing), a monogram
 * (never an uploaded photo), stack + BB count, D / SB / BB badges, the status
 * pill, the turn clock, its bet (a tab under the plate, never loose on the
 * felt), and the seat's cards exactly as holeCardGate decided
 * (`decision.cards` face up, else `decision.backs` card backs).
 */
import { memo } from 'react';
import Card2D from '../../../components/scene/Card2D.jsx';
import { broadcastName, monogram, monogramHue } from '../../model/broadcastNames.js';
import { formatChips, bbText } from '../../model/tableFormat.js';

function statusOf(seat, winner) {
  if (winner) return { cls: 'winner', text: 'Winner' };
  if (seat.eliminated) return { cls: 'out', text: 'Out' };
  if (seat.sittingOut) return { cls: 'away', text: 'Away' };
  if (seat.allIn) return { cls: 'allin', text: 'All in' };
  if (seat.folded) return { cls: 'fold', text: 'Fold' };
  return null;
}

function SeatPlate({ seat, pos, decision, bb, dealer, smallBlind, bigBlind, active, turnFrac, winner }) {
  const name = broadcastName(seat, seat.seatIndex);
  const hue = monogramHue(seat.pid || name);
  const status = statusOf(seat, winner);
  // Where the bet tab goes: under a bottom seat's plate; beside a side seat's
  // plate, facing the centre; beside a top seat's plate on its OUTER side (two
  // top seats facing each other would put their tabs on top of each other, and
  // under them is the pot).
  const betSide = pos.side === 'bottom' ? 'down'
    : pos.side === 'left' ? 'right'
      : pos.side === 'right' ? 'left'
        : (pos.x <= 50 ? 'left' : 'right');
  const cls = [
    'bc-seat',
    `bc-seat--${pos.side}`,
    `bc-seat--bet-${betSide}`,
    active ? 'bc-seat--active' : '',
    seat.folded ? 'bc-seat--folded' : '',
    seat.sittingOut ? 'bc-seat--away' : '',
    seat.eliminated ? 'bc-seat--out' : '',
    winner ? 'bc-seat--winner' : '',
  ].filter(Boolean).join(' ');
  const faces = decision && Array.isArray(decision.cards) ? decision.cards : null;
  const backs = !faces && decision ? decision.backs : 0;

  return (
    <div className={cls} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} data-seat={seat.seatIndex}>
      <div className="bc-seat__cards">
        {faces
          ? faces.map((c, i) => <Card2D key={`f${i}-${c.rank}-${c.suit}`} card={c} faceUp small dealDelay={i * 0.06} />)
          : Array.from({ length: backs }, (_, i) => <Card2D key={`b${i}`} card={null} faceUp={false} small dealDelay={i * 0.06} />)}
      </div>
      <div className="bc-seat__plate">
        {(dealer || smallBlind || bigBlind) ? (
          <div className="bc-seat__badges">
            {dealer ? <span className="bc-seat__badge bc-seat__badge--dealer">D</span> : null}
            {smallBlind ? <span className="bc-seat__badge">SB</span> : null}
            {bigBlind ? <span className="bc-seat__badge">BB</span> : null}
          </div>
        ) : null}
        {status ? <span className={`bc-seat__status bc-seat__status--${status.cls}`}>{status.text}</span> : null}
        <div className="bc-seat__avatar" style={{ background: `hsl(${hue}, 62%, 38%)` }}>{monogram(name)}</div>
        <div className="bc-seat__name">{name}</div>
        <div className="bc-seat__chips">
          {seat.eliminated ? '—' : formatChips(seat.chips)}
          {!seat.eliminated && bb ? <span className="bc-seat__bb">{bbText(seat.chips, bb)}</span> : null}
        </div>
        {Number.isFinite(seat.bet) && seat.bet > 0 ? (
          <div className="bc-seat__bet"><span className="bc-seat__bet-chip" />{formatChips(seat.bet)}</div>
        ) : null}
        {active && turnFrac !== null ? (
          <div className="bc-seat__turn">
            <div
              className={`bc-seat__turn-fill${turnFrac > 0.75 ? ' bc-seat__turn-fill--late' : ''}`}
              style={{ transform: `scaleX(${Math.max(0, 1 - turnFrac)})` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(SeatPlate);
