/**
 * RecapScene — cards-up hand replays after the event (lead spec C7 / P6,
 * 2026-11-02), with a PERMANENT 'REPLAY' bug (Facebook's Live policy: a
 * pre-recorded segment is labelled).
 *
 * Built dark in this release: P6 (poker-server recapHands + the cards-up
 * replay) is not built, so this scene draws NO cards at all — only the REPLAY
 * bug and a title card. scene.params is producer text, shown as plain text;
 * no card from any payload is ever read here (a hole-card leak on any public
 * path is a P0).
 */
import { memo } from 'react';
import { eventTitle } from '../../model/standings.js';

function paramText(program, key, max) {
  const p = program && program.scene && program.scene.params && typeof program.scene.params === 'object' ? program.scene.params : null;
  const v = p ? p[key] : null;
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function RecapScene({ program, layout }) {
  const title = paramText(program, 'title', 60) || 'Hand replays';
  const sub = paramText(program, 'sub', 100) || eventTitle(program);
  return (
    <div className="bc-scene bc-scene-recap" data-layout={layout}>
      <div className="bc-replay-bug">Replay</div>
      <div className="bc-recap__card">
        <div className="bc-recap__title">{title}</div>
        {sub ? <div className="bc-recap__sub">{sub}</div> : null}
      </div>
    </div>
  );
}

export default memo(RecapScene);
