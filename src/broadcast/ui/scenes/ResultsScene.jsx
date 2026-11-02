/**
 * ResultsScene — the finish (lead spec C4, 2026-11-02): the champion card,
 * then places 1..N with the seats won (a qualifier) or the chips (a Sit & Go;
 * play money). SceneSwitcher draws it ONLY when model/sceneMachine
 * resultsVisible() says the program clock has reached the finish; this
 * component checks again and draws nothing otherwise (fail-closed: a delayed
 * stream never shows the winner early).
 */
import { memo } from 'react';
import { resultsVisible } from '../../model/sceneMachine.js';
import { eventTitle, pageAt, pageCount, pageRows } from '../../model/standings.js';
import { ordinal, seatsWord } from '../../model/tickerFormat.js';
import { broadcastName } from '../../model/broadcastNames.js';
import { formatChips } from '../../model/tableFormat.js';

const PAGE_SIZE = 8;

function prizeText(r) {
  const seats = Number.isInteger(r.seatsWon) && r.seatsWon > 0 ? seatsWord(r.seatsWon) : '';
  if (seats) return `Wins ${seats}`;
  return Number.isFinite(r.amount) && r.amount > 0 ? `${formatChips(r.amount)} chips` : '';
}

function ResultsScene({ program, programNow, layout }) {
  if (!resultsVisible(program, programNow)) return null;
  const rows = program.results
    .filter((r) => r && typeof r === 'object' && Number.isInteger(r.place) && r.place > 0)
    .slice()
    .sort((a, b) => a.place - b.place);
  const champs = rows.filter((r) => r.place === 1);
  const pages = pageCount(rows, PAGE_SIZE);
  const page = pageAt(programNow, pages);
  const shown = pageRows(rows, page, PAGE_SIZE);
  return (
    <div className="bc-scene bc-scene-results" data-layout={layout}>
      <div className="bc-results__head">
        <div className="bc-results__kicker">{eventTitle(program)}</div>
        <div className="bc-results__title">Results</div>
      </div>
      {champs.length ? (
        <div className="bc-results__champ">
          <div className="bc-results__champ-label">{champs.length > 1 ? 'Co-champions' : 'Champion'}</div>
          <div className="bc-results__champ-name">{champs.map((c) => broadcastName(c)).join(' & ')}</div>
          {prizeText(champs[0]) ? <div className="bc-results__champ-prize">{prizeText(champs[0])}</div> : null}
        </div>
      ) : null}
      <div className="bc-results__list" key={`p${page}`}>
        {shown.map((r) => (
          <div key={`${r.place}-${r.pid || ''}`} className={`bc-results__row${prizeText(r) ? ' bc-results__row--prize' : ''}`}>
            <span className="bc-results__place">{ordinal(r.place)}{r.tied ? ' (tied)' : ''}</span>
            <span className="bc-results__name">{broadcastName(r)}</span>
            <span className="bc-results__prize">{prizeText(r)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ResultsScene);
