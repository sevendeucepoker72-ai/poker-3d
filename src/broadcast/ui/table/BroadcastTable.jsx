/**
 * BroadcastTable — the featured table as TV draws it (lead spec C2 + C5,
 * 2026-11-02). It does NOT embed PokerTable2D: that component reads the global
 * stores, listens on the app's main socket and has viewer-only features. It
 * shares Card2D (components/scene/Card2D.jsx) and the felt look.
 *
 * Every seat's cards go through holeCardGate ONCE here; SeatPlate and HoleCam
 * draw only that decision. Fills its parent box (the scene places it); the
 * 9:16 arrangement is a tall oval with the seats in two columns and a bigger
 * hole cam underneath.
 *
 * Props: table (BroadcastTableFrame), feed (effective Feed), layout,
 * serverNow (the page's estimate of the server clock — the delayed gate's
 * clock), programNow (the program clock — the turn timer on a delayed feed).
 *
 * 2026-11-02 (P5-C2b): the delayed hole cam's win % comes from
 * model/equity.js, fed the gate's decision (never seat.holeCards); it is null
 * on the public feed and whenever a hand still in is not face up.
 */
import { memo, useMemo } from 'react';
import Card2D from '../../../components/scene/Card2D.jsx';
import { gateHoleCards, isCard } from '../../model/holeCardGate.js';
import { equityForFrame } from '../../model/equity.js';
import { seatPositions, seatCountOf } from '../../model/seatLayout.js';
import { levelText, phaseText, turnFraction, winnerSeats } from '../../model/tableFormat.js';
import SeatPlate from './SeatPlate.jsx';
import HoleCam from './HoleCam.jsx';
import ActionStrip from './ActionStrip.jsx';
import PotDisplay from './PotDisplay.jsx';
import WinnerFx from './WinnerFx.jsx';
import TableChangeCard from './TableChangeCard.jsx';

const BETTING_PHASES = new Set(['PreFlop', 'Flop', 'Turn', 'River']);

function BroadcastTable({ table, feed, layout = '16x9', serverNow = NaN, programNow = NaN }) {
  const gate = useMemo(() => gateHoleCards(table, feed, { serverNow }), [table, feed, serverNow]);
  const equity = useMemo(() => {
    try {
      return equityForFrame(table, gate);
    } catch {
      return null;   // a number is decoration: it never takes the table down
    }
  }, [table, gate]);
  if (!table || !Array.isArray(table.seats)) return null;

  const n = seatCountOf(table.maxSeats);
  const positions = seatPositions(n, layout);
  const bySeat = new Map(table.seats.filter((s) => s && Number.isInteger(s.seatIndex)).map((s) => [s.seatIndex, s]));
  const bb = table.handLevel && Number.isFinite(table.handLevel.bb) ? table.handLevel.bb : 0;
  const winners = new Set(winnerSeats(table));
  const live = !table.handResult && BETTING_PHASES.has(table.phase);
  const turnFrac = live ? turnFraction(table, programNow) : null;
  const board = Array.isArray(table.board) ? table.board.filter(isCard).slice(0, 5) : [];
  const meta = [
    Number.isInteger(table.tableNo) ? `Table ${table.tableNo}` : (table.tableName || ''),
    Number.isInteger(table.handNumber) ? `Hand #${table.handNumber}` : '',
    levelText(table.handLevel),
    phaseText(table.phase),
  ].filter(Boolean).join(' · ');

  return (
    <div className={`bc-table bc-table--${layout}`} data-table-id={table.tableId} data-feed={gate.mode}>
      <div className="bc-felt" />
      <div className="bc-seat-ring">
        <div className="bc-center">
          <PotDisplay frame={table} />
          <div className="bc-board">
            {Array.from({ length: 5 }, (_, i) => (
              board[i]
                ? <Card2D key={`${table.handNumber}-${i}-${board[i].rank}-${board[i].suit}`} card={board[i]} faceUp dealDelay={0} />
                : <div key={`slot-${i}`} className="bc-board__slot" />
            ))}
          </div>
          {meta ? <div className="bc-hand-meta">{meta}</div> : null}
          <WinnerFx frame={table} />
          <ActionStrip frame={table} />
        </div>
        {positions.map((pos) => {
          const seat = bySeat.get(pos.seatIndex);
          if (!seat) return <div key={pos.seatIndex} className="bc-seat bc-seat--empty" style={{ left: `${pos.x}%`, top: `${pos.y}%` }} />;
          return (
            <SeatPlate
              key={pos.seatIndex}
              seat={seat}
              pos={pos}
              decision={gate.seats[pos.seatIndex] || null}
              bb={bb}
              dealer={table.dealerSeat === pos.seatIndex}
              smallBlind={table.smallBlindSeat === pos.seatIndex}
              bigBlind={table.bigBlindSeat === pos.seatIndex}
              active={live && table.activeSeat === pos.seatIndex}
              turnFrac={live && table.activeSeat === pos.seatIndex ? turnFrac : null}
              winner={winners.has(pos.seatIndex)}
            />
          );
        })}
      </div>
      <HoleCam frame={table} gate={gate} equity={equity} layout={layout} />
      <TableChangeCard tableId={table.tableId} tableNo={table.tableNo} tableName={table.tableName} />
    </div>
  );
}

export default memo(BroadcastTable);
