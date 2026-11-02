/**
 * RoomScene — the whole room at a glance (lead spec C4, 2026-11-02): up to 4
 * tables in a 2x2 grid (9:16: a column), paged every 8 s on the program clock
 * when there are more. PUBLIC information only, from the snapshot's table
 * summaries: players, hand number, pot, an ALL-IN badge, the biggest stack, a
 * star where the chip leader sits. No cards of any kind.
 */
import { memo } from 'react';
import TournamentBar from '../graphics/TournamentBar.jsx';
import { pageAt, pageCount, pageRows } from '../../model/standings.js';
import { formatChips } from '../../model/tableFormat.js';

const PAGE_SIZE = 4;

function RoomScene({ program, tables, programNow, layout }) {
  const list = (Array.isArray(tables) ? tables : [])
    .filter((t) => t && typeof t === 'object' && typeof t.tableId === 'string')
    .slice()
    .sort((a, b) => (Number(a.tableNo) || 999) - (Number(b.tableNo) || 999));
  const pages = pageCount(list, PAGE_SIZE);
  const page = pageAt(programNow, pages);
  const shown = pageRows(list, page, PAGE_SIZE);
  return (
    <div className="bc-scene bc-scene-room" data-layout={layout}>
      <TournamentBar program={program} programNow={programNow} layout={layout} compact={layout === '9x16'} />
      <div className="bc-room__grid" key={`p${page}`}>
        {shown.map((t) => (
          <div key={t.tableId} className={`bc-room__table${t.allIn ? ' bc-room__table--allin' : ''}`}>
            <div className="bc-room__name">
              {Number.isInteger(t.tableNo) ? `Table ${t.tableNo}` : String(t.tableName || 'Table').slice(0, 28)}
              {t.chipLeaderHere ? <span className="bc-room__star" title="Chip leader">{'★'}</span> : null}
            </div>
            {t.allIn ? <div className="bc-room__allin">All in</div> : null}
            <div className="bc-room__row"><span>Players</span>{Number.isInteger(t.players) ? t.players : '-'}</div>
            <div className="bc-room__row"><span>Hand</span>{Number.isInteger(t.handNumber) ? `#${t.handNumber}` : '-'}</div>
            <div className="bc-room__row"><span>Pot</span>{formatChips(t.pot)}</div>
            <div className="bc-room__row"><span>Big stack</span>{formatChips(t.biggestStack)}</div>
          </div>
        ))}
        {shown.length === 0 ? <div className="bc-room__empty">Tables open soon</div> : null}
      </div>
    </div>
  );
}

export default memo(RoomScene);
