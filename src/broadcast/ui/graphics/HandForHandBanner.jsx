/**
 * HandForHandBanner — 'HAND-FOR-HAND · Round 3 · Tables still playing: 2, 4'
 * (lead spec C3, 2026-11-02), from ProgramState.handForHand. With `grid`, a
 * row of table chips under it (waiting / playing / done), public info only.
 */
import { memo } from 'react';

const STATE_TEXT = { waiting: 'Waiting', playing: 'Playing', done: 'Done' };

function tableLabel(t, i) {
  return Number.isInteger(t.tableNo) ? `Table ${t.tableNo}` : `Table ${i + 1}`;
}

function HandForHandBanner({ program, grid = false, layout = '16x9' }) {
  const h = program && program.handForHand && typeof program.handForHand === 'object' ? program.handForHand : null;
  if (!h || h.on !== true) return null;
  const tables = Array.isArray(h.tables) ? h.tables.filter((t) => t && typeof t === 'object') : [];
  const playing = tables.filter((t) => t.state !== 'done').map((t, i) => (Number.isInteger(t.tableNo) ? t.tableNo : i + 1));
  const parts = ['HAND-FOR-HAND'];
  if (Number.isInteger(h.round) && h.round > 0) parts.push(`Round ${h.round}`);
  if (playing.length) parts.push(`Tables still playing: ${playing.join(', ')}`);
  else if (tables.length) parts.push('All tables done');
  return (
    <div className="bc-hfh" data-layout={layout}>
      <div className="bc-hfh__banner">{parts.join(' · ')}</div>
      {grid && tables.length ? (
        <div className="bc-hfh__grid">
          {tables.map((t, i) => {
            const state = STATE_TEXT[t.state] ? t.state : 'waiting';
            return (
              <div key={t.tableId || i} className={`bc-hfh__table bc-hfh__table--${state}`}>
                <span className="bc-hfh__table-no">{tableLabel(t, i)}</span>
                <span className="bc-hfh__table-state">{STATE_TEXT[state]}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default memo(HandForHandBanner);
