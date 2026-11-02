/**
 * TableScene — the featured table with the graphics package around it (lead
 * spec C4 + C5, 2026-11-02). `hfh` (the hand-for-hand scene) adds the
 * hand-for-hand banner and the grid of tables still playing.
 *
 * 16:9: tournament bar on top, the table (with its hole cam) in the middle,
 * chip leaders on the right, the ticker under the table.
 * 9:16: compact bar, a tall table, one rotating leaders card, the ticker —
 * everything inside the safe-zone bands (--bc-safe-top / --bc-safe-bottom).
 *
 * The table is CLA's BroadcastTable (`TableView`): every hole card it draws
 * went through holeCardGate. This scene never touches seat cards.
 */
import { memo } from 'react';
import TournamentBar from '../graphics/TournamentBar.jsx';
import ChipLeaders from '../graphics/ChipLeaders.jsx';
import BustTicker from '../graphics/BustTicker.jsx';
import HandForHandBanner from '../graphics/HandForHandBanner.jsx';

function waitingText(program) {
  const f = program && program.featured ? program.featured : null;
  if (f && Number.isInteger(f.tableNo)) return `Table ${f.tableNo} · next hand coming up`;
  return 'Next hand coming up';
}

function TableScene({ program, table, events, feed, layout, serverNow, programNow, TableView, hfh = false }) {
  const cls = hfh ? 'bc-scene bc-scene-table bc-scene-hfh' : 'bc-scene bc-scene-table';
  return (
    <div className={cls} data-layout={layout}>
      <TournamentBar program={program} programNow={programNow} layout={layout} compact={layout === '9x16'} />
      {hfh ? <HandForHandBanner program={program} grid layout={layout} /> : null}
      <div className="bc-table-box">
        {table && TableView
          ? <TableView table={table} feed={feed} layout={layout} serverNow={serverNow} programNow={programNow} />
          : <div className="bc-table-wait">{waitingText(program)}</div>}
      </div>
      <div className="bc-side">
        <ChipLeaders program={program} programNow={programNow} layout={layout} />
      </div>
      <div className="bc-ticker-box">
        <BustTicker program={program} events={events} programNow={programNow} layout={layout} />
      </div>
    </div>
  );
}

export default memo(TableScene);
