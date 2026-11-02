/**
 * SlateScene — "We'll be right back" (lead spec C4, 2026-11-02): the
 * producer's slate, a stale feed (no heartbeat for 15 s), a cancelled event.
 * It reuses the shell's slate (BroadcastErrorBoundary ShellSlate) so the
 * picture is identical whichever path put it up.
 */
import { memo } from 'react';
import { ShellSlate } from '../BroadcastErrorBoundary.jsx';
import { LEGAL_LINE } from '../../model/contract.js';

const SUB_BY_REASON = {
  cancelled: 'This event was cancelled.',
  stale: 'Reconnecting to the tables',
};

function SlateScene({ program, reason = '', layout }) {
  const legal = program && program.legal && typeof program.legal.line === 'string' && program.legal.line ? program.legal.line : LEGAL_LINE;
  return (
    <div className="bc-scene bc-scene-slate" data-layout={layout} data-reason={reason || undefined}>
      <ShellSlate reason={reason || 'scene'} sub={SUB_BY_REASON[reason] || ''} legal={legal} />
    </div>
  );
}

export default memo(SlateScene);
