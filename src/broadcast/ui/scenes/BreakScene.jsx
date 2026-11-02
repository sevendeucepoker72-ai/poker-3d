/**
 * BreakScene — the scheduled break (lead spec C4, 2026-11-02): when play
 * resumes (Mountain Time) and the countdown on the program clock, the top 10
 * in two columns, the next blinds, the field and the seats / bubble line.
 */
import { memo } from 'react';
import ChipLeaders from '../graphics/ChipLeaders.jsx';
import { programClock, countdownText, blindsLabel } from '../../model/programClock.js';
import { playersLine, avgLine, seatsLine, eventTitle } from '../../model/standings.js';
import { breakResumesText } from '../../../utils/tournamentClock.js';

function BreakScene({ program, programNow, layout }) {
  const pc = programClock(program, programNow);
  const resumesAt = pc && pc.resumesAt ? pc.resumesAt : null;
  const count = resumesAt ? countdownText(resumesAt, programNow) : '';
  const next = pc && pc.next && pc.next.bb && !pc.atTop ? pc.next : null;
  const facts = [playersLine(program && program.standings), avgLine(program && program.standings)].filter(Boolean).join(' · ');
  const seats = seatsLine(program && program.event, program && program.standings);
  return (
    <div className="bc-scene bc-scene-break" data-layout={layout}>
      <div className="bc-break__head">
        <div className="bc-break__kicker">{eventTitle(program)}</div>
        <div className="bc-break__title">Break</div>
        {count ? <div className="bc-break__count">{count}</div> : null}
        <div className="bc-break__resumes">{breakResumesText(resumesAt)}</div>
      </div>
      <div className="bc-break__body">
        <ChipLeaders program={program} programNow={programNow} layout={layout} all title="Top 10" />
        <div className="bc-break__facts">
          {pc && pc.blindsText ? <div className="bc-break__fact"><span>{pc.levelLabel || 'Blinds'}</span>{pc.blindsText}</div> : null}
          {next ? <div className="bc-break__fact"><span>Next level</span>{blindsLabel(next)}</div> : null}
          {facts ? <div className="bc-break__fact"><span>Field</span>{facts}</div> : null}
          {seats ? <div className="bc-break__fact bc-break__fact--gold"><span>Seats</span>{seats}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default memo(BreakScene);
