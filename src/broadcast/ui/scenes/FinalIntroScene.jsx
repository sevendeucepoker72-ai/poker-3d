/**
 * FinalIntroScene — the final table, player by player (lead spec C4,
 * 2026-11-02): a 'FINAL TABLE' title, then one card per seat for 4 s (seat
 * number, name, chips, big blinds, chip rank), with the whole table in a strip
 * underneath. The card on screen is a function of the program clock
 * (model/sceneMachine.js), so both layouts show the same seat. Auto: once per
 * event, from the first final-table moment; pinned by the producer: from the
 * pin, going round the seats.
 */
import { memo } from 'react';
import { finalTableSeats, finalIntroCard, pinnedIntroCard } from '../../model/sceneMachine.js';
import { programClock } from '../../model/programClock.js';
import { eventTitle } from '../../model/standings.js';
import { broadcastName, monogram, monogramHue } from '../../model/broadcastNames.js';
import { formatChips, bbText } from '../../model/tableFormat.js';
import { ordinal } from '../../model/tickerFormat.js';

function FinalIntroScene({ program, programNow, layout, pinned = false }) {
  const seats = finalTableSeats(program);
  const card = (pinned ? pinnedIntroCard(program, programNow) : finalIntroCard(program, programNow))
    || { index: -1, seat: null, leadIn: true };
  const pc = programClock(program, programNow);
  const bb = pc ? pc.bb : null;
  const byChips = seats.slice().sort((a, b) => (Number(b.chips) || 0) - (Number(a.chips) || 0));
  const rankOf = (s) => byChips.indexOf(s) + 1;
  const seat = card.seat;
  const name = seat ? broadcastName(seat, seat.seatIndex) : '';
  return (
    <div className="bc-scene bc-scene-final-intro" data-layout={layout}>
      {card.leadIn || !seat ? (
        <div className="bc-final__lead" key="lead">
          <div className="bc-final__kicker">{eventTitle(program)}</div>
          <div className="bc-final__title">Final table</div>
          {seats.length ? <div className="bc-final__sub">{seats.length} players left</div> : null}
        </div>
      ) : (
        <div className="bc-final__card" key={`seat-${seat.seatIndex}`}>
          <div className="bc-final__seat">Seat {Number.isInteger(seat.seatIndex) ? seat.seatIndex + 1 : ''}</div>
          <div className="bc-final__avatar" style={{ background: `hsl(${monogramHue(seat.pid || name)}, 62%, 38%)` }}>{monogram(name)}</div>
          <div className="bc-final__name">{name}</div>
          <div className="bc-final__chips">{formatChips(seat.chips)}</div>
          <div className="bc-final__meta">
            {bb ? <span>{bbText(seat.chips, bb)}</span> : null}
            <span>{ordinal(rankOf(seat))} in chips</span>
          </div>
        </div>
      )}
      {seats.length ? (
        <div className="bc-final__strip">
          {seats.map((s) => (
            <div key={s.pid || s.seatIndex} className={`bc-final__chip${seat && s === seat ? ' bc-final__chip--on' : ''}`}>
              <span className="bc-final__chip-name">{broadcastName(s, s.seatIndex)}</span>
              <span className="bc-final__chip-stack">{formatChips(s.chips)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default memo(FinalIntroScene);
