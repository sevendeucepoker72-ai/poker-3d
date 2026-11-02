/**
 * LowerThirds — the producer's captions (lead spec C3, 2026-11-02): host,
 * info, player spotlight, legal, venue. ProgramState.lowerThirds is the
 * server's list; an item shows until its `until` (program clock; null = until
 * the producer hides it). It slides in, and slides out over its last
 * OUT_MS when it has an `until` (a producer Hide removes it at once). At most
 * two at a time, newest on top. Text is plain text (React escapes it).
 */
import { memo } from 'react';
import { isObj } from '../../model/contract.js';

const LOWER_THIRD_OUT_MS = 450;
const KINDS = new Set(['host', 'info', 'player', 'legal', 'venue']);

function clip(s, n) {
  return typeof s === 'string' ? s.trim().slice(0, n) : '';
}

function LowerThirds({ program, programNow, layout = '16x9' }) {
  const list = program && Array.isArray(program.lowerThirds) ? program.lowerThirds.filter(isObj) : [];
  const live = list.filter((it) => clip(it.title, 80)
    && !(Number.isFinite(it.until) && Number.isFinite(programNow) && programNow >= it.until)).slice(-2);
  if (live.length === 0) return null;
  return (
    <div className="bc-lower-thirds" data-layout={layout}>
      {live.map((it, i) => {
        const kind = KINDS.has(it.kind) ? it.kind : 'info';
        const leaving = Number.isFinite(it.until) && Number.isFinite(programNow) && it.until - programNow <= LOWER_THIRD_OUT_MS;
        const sub = clip(it.sub, 120);
        return (
          <div
            key={typeof it.id === 'string' || Number.isFinite(it.id) ? String(it.id) : `lt-${i}`}
            className={`bc-lower-third bc-lower-third--${kind}${leaving ? ' bc-lower-third--out' : ''}`}
          >
            <div className="bc-lower-third__title">{clip(it.title, 80)}</div>
            {sub ? <div className="bc-lower-third__sub">{sub}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export default memo(LowerThirds);
