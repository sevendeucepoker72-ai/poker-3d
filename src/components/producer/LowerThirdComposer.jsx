/**
 * LowerThirdComposer — captions on air (lead spec C6, 2026-11-02): presets
 * (host, how to enter, the legal line, 'not sponsored by Meta', venue thanks,
 * player spotlight), editable before they go up; a duration (seconds on the
 * program clock, 0 = until hidden); Hide for any caption on air.
 * `bc:producer:lowerThird` {channel, op:'show'|'hide', item}. Plain text.
 *
 * Review 2026-11-02 — a 'player' (spotlight) caption is PICKED, never typed:
 * the producer chooses an entrant and the caption carries the name the server
 * already shows for him (First L., or "Player" when he opted out;
 * producerModel spotlightEntrants). Before, the title was free text, so a full
 * name or a hidden player's name could go on air.
 */
import { useState } from 'react';
import { lowerThirdPresets, lowerThirdItem, spotlightEntrants, programClockNow, isObj } from './producerModel.js';

const KINDS = ['host', 'info', 'player', 'legal', 'venue'];
let seq = 0;

function nextId() {
  seq += 1;
  return `lt-${Date.now().toString(36)}-${seq}`;
}

export default function LowerThirdComposer({ program, table = null, channel, call, stateAt }) {
  const [kind, setKind] = useState('info');
  const [title, setTitle] = useState('');
  const [sub, setSub] = useState('');
  const [secs, setSecs] = useState(15);
  const [pid, setPid] = useState('');
  const presets = lowerThirdPresets(program);
  const entrants = spotlightEntrants(program, table);
  const picked = kind === 'player' ? entrants.find((e) => e.pid === pid) || null : null;
  const onAir = program && Array.isArray(program.lowerThirds) ? program.lowerThirds.filter(isObj) : [];

  const show = () => {
    // The program clock now: the program's time plus what passed since the state arrived.
    const pn = programClockNow(program, stateAt);
    const item = lowerThirdItem({ id: nextId(), kind, title, sub, durationSec: secs, programNow: pn, pid, entrants });
    if (!item) return;
    call('lowerThird', { channel, op: 'show', item }, 'Caption on air.');
  };

  return (
    <div className="bcp-card">
      <div className="bcp-card__title">Lower thirds</div>
      <div className="bcp-presets">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className="bcp-btn bcp-btn--ghost"
            onClick={() => { setKind(p.kind); setTitle(p.title); setSub(p.sub); if (p.kind === 'player') setPid(''); }}
          >
            {p.key === 'meta' ? 'Not Meta' : (p.title || p.sub || p.key).slice(0, 22)}
          </button>
        ))}
      </div>
      <div className="bcp-form">
        <select className="bcp-input bcp-input--small" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {kind === 'player' ? (
          <select className="bcp-input bcp-spotlight-pick" value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Player">
            <option value="">{entrants.length ? 'Pick a player' : 'No players on the program yet'}</option>
            {entrants.map((e) => (
              <option key={e.pid} value={e.pid}>{e.name}{e.chips !== null ? ` (${e.chips.toLocaleString('en-US')})` : ''}</option>
            ))}
          </select>
        ) : (
          <input className="bcp-input" value={title} maxLength={80} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
        )}
        <input className="bcp-input" value={sub} maxLength={120} placeholder="Second line (optional)" onChange={(e) => setSub(e.target.value)} />
        <label className="bcp-check">
          Seconds
          <input
            className="bcp-input bcp-input--small"
            type="number"
            min={0}
            max={600}
            value={secs}
            onChange={(e) => setSecs(Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))))}
          />
        </label>
        <button type="button" className="bcp-btn bcp-btn--gold" disabled={kind === 'player' ? !picked : !title.trim()} onClick={show}>Show</button>
      </div>
      {kind === 'player' ? (
        <div className="bcp-hint">Player names come from the program: First L., or Player for anyone who opted out.</div>
      ) : null}
      {onAir.length ? (
        <div className="bcp-list">
          {onAir.map((it) => (
            <div key={String(it.id)} className="bcp-list__row">
              <span>{String(it.title || '').slice(0, 60)}</span>
              <button type="button" className="bcp-btn bcp-btn--ghost" onClick={() => call('lowerThird', { channel, op: 'hide', item: { id: it.id } }, 'Caption hidden.')}>Hide</button>
            </div>
          ))}
        </div>
      ) : <div className="bcp-hint">No captions on air.</div>}
    </div>
  );
}
