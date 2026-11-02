/**
 * GoLiveChecklist — before the producer presses Go on air (lead spec C6,
 * 2026-11-02). The first four are checked from the live state (event bound,
 * fresh producer feed, the legal line on air, OBS sources connected); the
 * rest are the producer's own ticks for this session (not stored).
 */
import { useState } from 'react';
import { goLiveChecklist } from './producerModel.js';

export default function GoLiveChecklist({ program, channelRow, stateAgeMs }) {
  const [manual, setManual] = useState({});
  const { items, ready } = goLiveChecklist({ program, channel: channelRow, stateAgeMs, manual });
  return (
    <div className="bcp-card">
      <div className="bcp-card__title">
        Go-live checklist
        <span className={`bcp-badge${ready ? ' bcp-badge--gold' : ''}`}>{ready ? 'Ready' : 'Not ready'}</span>
      </div>
      <div className="bcp-checklist">
        {items.map((it) => (
          <label key={it.id} className={`bcp-checklist__row${it.ok ? ' bcp-checklist__row--ok' : ''}`}>
            {it.auto ? (
              <span className="bcp-checklist__mark" aria-hidden="true">{it.ok ? '✓' : '○'}</span>
            ) : (
              <input type="checkbox" checked={it.ok} onChange={(e) => setManual((m) => ({ ...m, [it.id]: e.target.checked }))} />
            )}
            <span>{it.label}</span>
            {it.auto ? <span className="bcp-checklist__auto">auto</span> : null}
          </label>
        ))}
      </div>
    </div>
  );
}
