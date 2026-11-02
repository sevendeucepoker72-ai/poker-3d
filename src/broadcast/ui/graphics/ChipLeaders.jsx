/**
 * ChipLeaders — the top 10 by chips (lead spec C3, 2026-11-02): paged every
 * 8 s on the PROGRAM clock (both layouts show the same page), rank arrows
 * (gold up, blue down, never red), the stack and its big blinds. 9:16 shows
 * one leader at a time (5 s each). `all` draws every row at once in two
 * columns (the break scene).
 */
import { memo } from 'react';
import { leaderRows, pageCount, pageAt, pageRows, LEADER_PAGE_MS } from '../../model/standings.js';
import { programClock } from '../../model/programClock.js';

const MOVE_GLYPH = { up: '▲', down: '▼', same: '–', new: '•' };
const SINGLE_CARD_MS = 5000;

function ChipLeaders({ program, programNow, layout = '16x9', all = false, title = 'Chip leaders' }) {
  if (!program) return null;
  const pc = programClock(program, programNow);
  const rows = leaderRows(program.standings, pc ? pc.bb : null);
  if (rows.length === 0) return null;
  // 9:16 (lead spec C5): one leader at a time, a single rotating card.
  const single = !all && layout === '9x16';
  const pageSize = all ? rows.length : (single ? 1 : 5);
  const pages = pageCount(rows, pageSize);
  const page = pageAt(programNow, pages, single ? SINGLE_CARD_MS : LEADER_PAGE_MS);
  const shown = pageRows(rows, page, pageSize);
  return (
    <div className={`bc-chip-leaders${all ? ' bc-chip-leaders--all' : ''}`} data-layout={layout}>
      <div className="bc-chip-leaders__head">
        <span>{title}</span>
        {pages > 1 ? <span className="bc-chip-leaders__page">{page + 1}/{pages}</span> : null}
      </div>
      <div className="bc-chip-leaders__rows" key={`p${page}`}>
        {shown.map((r) => (
          <div key={r.pid} className="bc-leader">
            <span className="bc-leader__rank">{r.rankLabel}</span>
            <span className={`bc-leader__move bc-leader__move--${r.move}`} aria-label={r.move}>{MOVE_GLYPH[r.move]}</span>
            <span className="bc-leader__name">{r.name}</span>
            <span className="bc-leader__chips">{r.chipsText}</span>
            <span className="bc-leader__bb">{r.bbText}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ChipLeaders);
