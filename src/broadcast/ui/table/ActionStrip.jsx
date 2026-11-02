/**
 * ActionStrip — the last action under the board, 'J. S. raises to 2,400'
 * (lead spec C2, 2026-11-02). Re-animates on every new action.
 */
import { memo } from 'react';
import { actionLine } from '../../model/tableFormat.js';

function ActionStrip({ frame }) {
  const text = actionLine(frame);
  if (!text || (frame && frame.handResult)) return null;
  return <div className="bc-action-strip" key={`${frame.handNumber}:${text}`}>{text}</div>;
}

export default memo(ActionStrip);
