/**
 * PotDisplay — main pot and side pots in the middle of the felt (lead spec C2,
 * 2026-11-02).
 */
import { memo } from 'react';
import { formatChips, potRows } from '../../model/tableFormat.js';

function PotDisplay({ frame }) {
  const rows = potRows(frame);
  if (rows.length === 0) return null;
  return (
    <div className="bc-pot">
      {rows.map((r) => (
        <div key={r.label} className="bc-pot__row">
          <span className="bc-pot__label">{r.label}</span>{formatChips(r.amount)}
        </div>
      ))}
    </div>
  );
}

export default memo(PotDisplay);
