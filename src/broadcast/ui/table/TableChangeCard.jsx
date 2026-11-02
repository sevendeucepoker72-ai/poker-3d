/**
 * TableChangeCard — 'Now: Table 3' for 2.5 s when the featured table changes
 * (lead spec C2, 2026-11-02). The server re-points the program on a featured
 * switch or a table break; the first table of a page load gets no card.
 */
import { memo, useEffect, useState } from 'react';

const SHOW_MS = 2500;

function labelOf(tableNo, tableName) {
  if (Number.isInteger(tableNo)) return `Now: Table ${tableNo}`;
  return tableName ? `Now: ${String(tableName).slice(0, 32)}` : 'Now: next table';
}

function TableChangeCard({ tableId, tableNo, tableName }) {
  // "Storing information from previous renders": the card starts on a change of
  // tableId seen during render, never for the first table.
  const [prevId, setPrevId] = useState(tableId);
  const [shownFor, setShownFor] = useState(null);
  if (tableId !== prevId) {
    setPrevId(tableId);
    setShownFor(prevId ? tableId : null);
  }

  useEffect(() => {
    if (!shownFor) return undefined;
    const t = setTimeout(() => setShownFor(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [shownFor]);

  if (!shownFor || shownFor !== tableId) return null;
  return <div className="bc-table-change" key={shownFor}>{labelOf(tableNo, tableName)}</div>;
}

export default memo(TableChangeCard);
