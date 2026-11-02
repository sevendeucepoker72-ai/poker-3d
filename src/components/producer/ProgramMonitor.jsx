/**
 * ProgramMonitor — what OBS is putting on air, drawn by the SAME code
 * (lead spec C6, 2026-11-02): the producer state's program Snapshot goes
 * through the page's own store (applySnapshot: a public feed's table frame is
 * stripped of live cards there) into BroadcastProgramView, the broadcast
 * page's Stage, scaled into this box. WYSIWYG: same scene machine, same
 * graphics, same hole-card gate.
 *
 * The broadcast stylesheet is injected SCOPED (broadcastCssScope.js): only
 * its .bc-* rules, --bc-* tokens and keyframes, never its html / body rules,
 * and it is removed again when the monitor closes.
 */
import { useEffect, useMemo, useState } from 'react';
import broadcastCssText from '../../broadcast/broadcast.css?inline';
import { BroadcastProgramView } from '../../broadcast/BroadcastApp.jsx';
import { applySnapshot, initialProgramState } from '../../broadcast/model/programStore.js';
import { levelForAge } from '../../broadcast/model/feedHealth.js';
import { scopeBroadcastCss } from './broadcastCssScope.js';
import { onAirVsLive, isObj } from './producerModel.js';

const STYLE_ID = 'bc-producer-stage-css';
let styleUsers = 0;

function useScopedBroadcastCss() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    styleUsers += 1;
    if (!document.getElementById(STYLE_ID)) {
      const el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = scopeBroadcastCss(broadcastCssText);
      document.head.appendChild(el);
    }
    return () => {
      styleUsers -= 1;
      if (styleUsers <= 0) {
        styleUsers = 0;
        const el = document.getElementById(STYLE_ID);
        if (el) el.remove();
      }
    };
  }, []);
}

function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function ProgramMonitor({ state, stateAt }) {
  useScopedBroadcastCss();
  const now = useNow(250);
  const [layout, setLayout] = useState('16x9');
  const snap = isObj(state) && isObj(state.program) ? state.program : null;
  const programState = useMemo(
    // The state and its arrival time are set together (ProducerPanel), so a snapshot always has stateAt.
    () => (snap && Number.isFinite(stateAt) ? applySnapshot(initialProgramState(), snap, stateAt) : initialProgramState()),
    [snap, stateAt],
  );
  const health = Number.isFinite(stateAt) ? levelForAge(now - stateAt) : 'stale';
  const vs = onAirVsLive(state);
  return (
    <div className="bcp-card bc-producer-program">
      <div className="bcp-card__title">
        Program (what OBS shows)
        <span className="bcp-seg">
          <button type="button" className={`bcp-seg__btn${layout === '16x9' ? ' bcp-seg__btn--on' : ''}`} onClick={() => setLayout('16x9')}>16:9</button>
          <button type="button" className={`bcp-seg__btn${layout === '9x16' ? ' bcp-seg__btn--on' : ''}`} onClick={() => setLayout('9x16')}>9:16</button>
        </span>
      </div>
      <div className={`bcp-monitor bcp-monitor--${layout}`}>
        {snap ? (
          <BroadcastProgramView programState={programState} feedHealth={health} layout={layout} fit="parent" now={now} />
        ) : (
          <div className="bcp-monitor__empty">Waiting for the program…</div>
        )}
      </div>
      {vs ? <div className="bcp-kv"><span>Hands</span><b>{vs}</b></div> : null}
    </div>
  );
}
