/**
 * EventPicker — which channel the panel drives, and which event it is bound to
 * (lead spec C6 + R2, 2026-11-02). A channel (main / weekly / monthly / sitgo)
 * is bound to an event key up to a week ahead: a qualifier ('q:<id>'), a
 * tournament ('t:<id>'), or the next Weekly / Monthly ('next:weekly' /
 * 'next:monthly', auto-advancing). The OBS URL names the CHANNEL, so it is set
 * once. `bc:producer:setEvent` {channel, event}.
 */
import { useState } from 'react';
import { CHANNEL_LABELS, isObj } from './producerModel.js';
import { formatDenverWhen } from '../../utils/qualifierList.js';

const NEXT_KEYS = [
  { eventKey: 'next:weekly', name: 'Next Weekly (auto-advance)' },
  { eventKey: 'next:monthly', name: 'Next Monthly (auto-advance)' },
];

export default function EventPicker({ hello, channel, channels, onChannel, program, call }) {
  const [pick, setPick] = useState('');
  const rows = hello && Array.isArray(hello.channels) ? hello.channels.filter(isObj) : [];
  const events = hello && Array.isArray(hello.events) ? hello.events.filter((e) => isObj(e) && typeof e.eventKey === 'string') : [];
  const ev = program && isObj(program.event) ? program.event : null;
  const options = [...NEXT_KEYS, ...events];
  return (
    <div className="bcp-card">
      <div className="bcp-card__title">Channel and event</div>
      <div className="bcp-tabs" role="tablist">
        {channels.map((c) => {
          const row = rows.find((r) => r.channel === c);
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === channel}
              className={`bcp-tab${c === channel ? ' bcp-tab--on' : ''}`}
              onClick={() => onChannel(c)}
            >
              {row && row.onAir ? <span className="bcp-dot bcp-dot--air" title="On air" /> : null}
              {CHANNEL_LABELS[c] || c}
              {row && row.eventName ? <span className="bcp-tab__sub">{String(row.eventName).slice(0, 28)}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="bcp-kv">
        <span>Bound to</span>
        <b>{ev ? `${ev.title || ev.name || 'Event'} · ${ev.status}` : 'Nothing yet'}</b>
      </div>
      {program && program.eventKey ? <div className="bcp-kv"><span>Event key</span><code>{program.eventKey}</code></div> : null}
      <div className="bcp-row">
        <select className="bcp-input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Event">
          <option value="">Choose an event…</option>
          {options.map((o) => (
            <option key={o.eventKey} value={o.eventKey}>
              {o.name}{Number.isFinite(o.scheduledAt) ? ` · ${formatDenverWhen(o.scheduledAt)}` : ''}{o.phase ? ` · ${o.phase}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="bcp-btn bcp-btn--gold"
          disabled={!pick}
          onClick={() => call('setEvent', { channel, event: pick }, `Channel ${CHANNEL_LABELS[channel] || channel} is bound to ${pick}.`)}
        >
          Bind
        </button>
      </div>
    </div>
  );
}
