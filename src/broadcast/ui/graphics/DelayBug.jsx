/**
 * DelayBug — 'Delayed broadcast · 5 min' (lead spec C3 / P5, 2026-11-02),
 * shown ONLY when the feed is delayed. The minutes are read from the feed's
 * configured delay (owner 2026-11-02: 5 minutes minimum and default,
 * configurable upward), never written as a fixed number.
 * 2026-11-02 (P5-C2b, CLA): the text comes from model/delayBug.js, which falls
 * back to the 5-minute default when a delayed feed's delay is missing, so a
 * delayed stream is never on air without its bug.
 */
import { memo } from 'react';
import { delayBugMinutes, DELAY_BUG_TEXT } from '../../model/delayBug.js';

function DelayBug({ feed, delayMs, layout = '16x9' }) {
  const minutes = delayBugMinutes(feed, delayMs);
  if (minutes === null) return null;
  return (
    <div className="bc-delay-bug" data-layout={layout}>
      <span className="bc-delay-bug__dot" />
      {DELAY_BUG_TEXT} · {minutes} min
    </div>
  );
}

export default memo(DelayBug);
