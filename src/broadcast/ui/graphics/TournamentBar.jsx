/**
 * TournamentBar — the persistent top bar of the broadcast (lead spec C3,
 * 2026-11-02): event title (the producer's override, else the server name),
 * level n of N, blinds and ante, the level clock, the next level, players
 * left of entries, the average stack in chips and BB, and the seats line
 * ('Top 3 win a championship seat · 19 to the bubble').
 *
 * Everything is on the PROGRAM clock (model/programClock.js): a delayed feed
 * counts down the level the viewers are watching. The bar fill animates with
 * transform only (OBS's browser). Blue, gold, amber; never red.
 */
import { memo } from 'react';
import { programClock, clockStatusWord } from '../../model/programClock.js';
import { playersLine, avgLine, seatsLine, eventTitle } from '../../model/standings.js';

function TournamentBar({ program, programNow, layout = '16x9', compact = false }) {
  if (!program) return null;
  const pc = programClock(program, programNow);
  const status = clockStatusWord(pc);
  const players = playersLine(program.standings);
  const avg = avgLine(program.standings);
  const seats = seatsLine(program.event, program.standings);
  const frac = pc && pc.barFraction !== null && pc.barFraction !== undefined ? pc.barFraction : null;
  return (
    <div className={`bc-tournament-bar${compact ? ' bc-tournament-bar--compact' : ''}`} data-layout={layout}>
      <div className="bc-tbar__title">{eventTitle(program)}</div>
      {pc ? (
        <div className="bc-tbar__level">
          {pc.levelLabel ? <span className="bc-tbar__lvl">{pc.levelLabel}</span> : null}
          <span className="bc-tbar__blinds">{pc.blindsText}</span>
        </div>
      ) : null}
      {pc ? (
        <div className={`bc-tbar__clock bc-tbar__clock--${pc.tone}${status ? ' bc-tbar__clock--held' : ''}`}>
          <span className="bc-tbar__time">{pc.clockText || '--:--'}</span>
          {status ? <span className="bc-tbar__status">{status}</span> : null}
          {frac !== null ? (
            <span className="bc-tbar__bar"><span className="bc-tbar__bar-fill" style={{ transform: `scaleX(${frac})` }} /></span>
          ) : null}
        </div>
      ) : null}
      {pc && pc.nextText ? <div className="bc-tbar__next">{pc.nextText}</div> : null}
      {players || avg ? (
        <div className="bc-tbar__field">
          {players ? <span className="bc-tbar__players">{players}</span> : null}
          {avg ? <span className="bc-tbar__avg">{avg}</span> : null}
        </div>
      ) : null}
      {seats ? <div className="bc-tbar__seats">{seats}</div> : null}
    </div>
  );
}

export default memo(TournamentBar);
