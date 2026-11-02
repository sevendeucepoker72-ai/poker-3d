/**
 * StartingSoonScene — before the cards are in the air (lead spec C4,
 * 2026-11-02): the event name, a countdown to the deal (dealsAt, else the
 * scheduled start) on the program clock, the start in Mountain Time, the
 * seat package in words, the registered count, how to enter, and rotating
 * 'how it works' cards (6 s each, on the program clock so both layouts agree).
 * Text only: no QR code (owner default N10, no new dependency).
 */
import { memo } from 'react';
import { countdownText } from '../../model/programClock.js';
import { eventTitle, howItWorksCards, startTimeOf } from '../../model/standings.js';
import { formatDenverTime, formatDenverWhen } from '../../../utils/qualifierList.js';

const CARD_MS = 6000;
const DAY_MS = 24 * 3600 * 1000;
const STATUS_KICKER = {
  scheduled: 'Coming up',
  registering: 'Registration open',
  tables_open: 'Tables are open',
};

function StartingSoonScene({ program, programNow, layout }) {
  const ev = (program && program.event) || {};
  const at = startTimeOf(program);
  const far = at !== null && Number.isFinite(programNow) && at - programNow > DAY_MS;
  const count = at !== null && !far ? countdownText(at, programNow) : '';
  const when = at !== null ? (far ? formatDenverWhen(at) : formatDenverTime(at)) : '';
  const cards = howItWorksCards(program);
  const card = cards[Number.isFinite(programNow) ? Math.floor(programNow / CARD_MS) % cards.length : 0];
  const registered = Number.isInteger(ev.registered) && ev.registered > 0 ? ev.registered : null;
  return (
    <div className="bc-scene bc-scene-starting" data-layout={layout}>
      <div className="bc-starting__kicker">{STATUS_KICKER[ev.status] || 'Starting soon'}</div>
      <div className="bc-starting__title">{eventTitle(program)}</div>
      {count ? <div className="bc-starting__count">{count}</div> : null}
      {when ? <div className="bc-starting__when">{far ? when : `Cards in the air at ${when}`}</div> : null}
      {registered ? <div className="bc-starting__reg">{registered.toLocaleString('en-US')} registered</div> : null}
      {card ? (
        <div className="bc-starting__card" key={card.head}>
          <div className="bc-starting__card-head">{card.head}</div>
          {card.body ? <div className="bc-starting__card-body">{card.body}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default memo(StartingSoonScene);
