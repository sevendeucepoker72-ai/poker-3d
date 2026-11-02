/**
 * BustTicker — what just happened (lead spec C3, 2026-11-02): '14th · A. B. ·
 * busted by C. D.', 'SEAT WON · 3rd · E. F. (1 seat)', level up, break,
 * hand-for-hand, final table. The program's ticker plus the event frames that
 * came after it, on the PROGRAM clock (model/tickerFormat.js holds back any
 * item stamped after programNow). The newest item slides in (transform only).
 */
import { memo } from 'react';
import { mergeTicker, latestTickerItems } from '../../model/tickerFormat.js';

function BustTicker({ program, events, programNow, layout = '16x9', count }) {
  if (!program) return null;
  const n = Number.isInteger(count) && count > 0 ? count : (layout === '9x16' ? 2 : 3);
  const items = latestTickerItems(mergeTicker(program.ticker, events, programNow), n);
  if (items.length === 0) return null;
  return (
    <div className="bc-bust-ticker" data-layout={layout}>
      {items.map((it, i) => (
        <div
          key={it.id || `${it.kind}-${it.t}-${i}`}
          className={`bc-ticker-item bc-ticker-item--${it.tone}${i === 0 ? ' bc-ticker-item--newest' : ''}`}
        >
          <span className="bc-ticker-item__label">{it.label}</span>
          <span className="bc-ticker-item__text">{it.text}</span>
        </div>
      ))}
    </div>
  );
}

export default memo(BustTicker);
