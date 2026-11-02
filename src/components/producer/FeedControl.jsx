/**
 * FeedControl — on air, the feed mode and the hole-card switch (lead spec C6 +
 * P5, 2026-11-02).
 *
 * - On air / off air, with Rehearsal (`bc:producer:onAir` {channel, onAir,
 *   rehearsal}). On air also freezes .online deploys (deploy-online.mjs).
 * - Feed: public (live, no hole cards) or delayed (`setFeed` {channel, mode,
 *   delayMin}); owner 2026-11-02: the delay is at least 5 minutes, 5 by default,
 *   configurable upward (the server enforces the floor: delay_below_minimum).
 * - Hole cards (P5, BUILT DARK): pin the delayed table (`delayedPin`
 *   {tableId|null}, null = the featured table) and the producer switch
 *   (`holeCardsSwitch` {on}). The server answers 'holecards_off' until the
 *   owner turns the policy on after the security review, and 'on' also needs
 *   an allowlisted issuer (the owner). A hand's cards are never released while
 *   that hand is still being played live.
 */
import { useState } from 'react';
import { clampDelayMin, DEFAULT_DELAY_MIN, MIN_DELAY_MIN, liveTiles, isObj, FEED_DELAY_HINT } from './producerModel.js';

export default function FeedControl({ state, program, channel, call }) {
  const snapFeed = isObj(state) && isObj(state.program) && isObj(state.program.feed) ? state.program.feed : null;
  const [mode, setMode] = useState(snapFeed && snapFeed.mode === 'delayed' ? 'delayed' : 'public');
  const [delayMin, setDelayMin] = useState(
    snapFeed && snapFeed.mode === 'delayed' && Number.isFinite(snapFeed.delayMs) ? clampDelayMin(snapFeed.delayMs / 60000) : DEFAULT_DELAY_MIN,
  );
  const [rehearsal, setRehearsal] = useState(!!(program && program.rehearsal));
  const [pin, setPin] = useState('');
  const onAir = !!(program && program.onAir);
  const tiles = liveTiles(isObj(state) ? state.live : null);
  const feedText = snapFeed
    ? `${snapFeed.mode === 'delayed' ? `Delayed ${Math.round((snapFeed.delayMs || 0) / 60000)} min` : 'Public (live)'}`
      + ` · hole cards ${snapFeed.holeCards ? 'on' : 'off'} · policy ${snapFeed.policy || 'off'}`
    : 'Unknown';

  return (
    <div className="bcp-card">
      <div className="bcp-card__title">On air and feed</div>
      <div className="bcp-row">
        <span className={`bcp-air${onAir ? ' bcp-air--on' : ''}`}>{onAir ? (program && program.rehearsal ? 'Rehearsal' : 'On air') : 'Off air'}</span>
        <label className="bcp-check">
          <input type="checkbox" checked={rehearsal} onChange={(e) => setRehearsal(e.target.checked)} />
          Rehearsal
        </label>
        <button
          type="button"
          className={`bcp-btn ${onAir ? 'bcp-btn--ghost' : 'bcp-btn--gold'}`}
          onClick={() => call('onAir', { channel, onAir: !onAir, rehearsal }, onAir ? 'Off air.' : (rehearsal ? 'Rehearsal on air.' : 'On air. .online deploys are frozen.'))}
        >
          {onAir ? 'Go off air' : 'Go on air'}
        </button>
      </div>
      <div className="bcp-kv"><span>Feed now</span><b>{feedText}</b></div>
      <div className="bcp-row">
        <label className="bcp-check">
          <input type="radio" name="bcp-feed-mode" checked={mode === 'public'} onChange={() => setMode('public')} />
          Public (live)
        </label>
        <label className="bcp-check">
          <input type="radio" name="bcp-feed-mode" checked={mode === 'delayed'} onChange={() => setMode('delayed')} />
          Delayed
        </label>
        <label className="bcp-check">
          Minutes
          <input
            className="bcp-input bcp-input--small"
            type="number"
            min={MIN_DELAY_MIN}
            max={240}
            value={delayMin}
            disabled={mode !== 'delayed'}
            onChange={(e) => setDelayMin(e.target.value)}
            onBlur={(e) => setDelayMin(clampDelayMin(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="bcp-btn"
          onClick={() => {
            const m = clampDelayMin(delayMin);
            setDelayMin(m);
            call('setFeed', { channel, mode, delayMin: mode === 'delayed' ? m : 0 }, mode === 'delayed' ? `Feed delayed ${m} min.` : 'Feed is public (live).');
          }}
        >
          Apply
        </button>
      </div>
      {/* Review 2026-11-02: the delay covers delayed-key sources only; the public URL stays live. */}
      <div className="bcp-hint">{FEED_DELAY_HINT}</div>

      <div className="bcp-sub">Hole cards (delayed feed only)</div>
      <div className="bcp-row">
        <select className="bcp-input" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="Hole-card table">
          <option value="">The featured table</option>
          {tiles.map((t) => <option key={t.tableId} value={t.tableId}>{t.label}</option>)}
        </select>
        <button type="button" className="bcp-btn" onClick={() => call('delayedPin', { tableId: pin || null }, pin ? 'Hole-card table pinned.' : 'Hole cards follow the featured table.')}>
          Pin
        </button>
      </div>
      <div className="bcp-row">
        <button type="button" className="bcp-btn" onClick={() => call('holeCardsSwitch', { on: true }, 'Hole cards switched on for the delayed feed.')}>
          Hole cards on
        </button>
        <button type="button" className="bcp-btn bcp-btn--ghost" onClick={() => call('holeCardsSwitch', { on: false }, 'Hole cards switched off.')}>
          Hole cards off
        </button>
      </div>
      <div className="bcp-hint">
        Hole cards show only on the delayed feed, at least {MIN_DELAY_MIN} minutes behind, and never while that hand is still being played.
        The server keeps them off until the owner turns the policy on.
      </div>
    </div>
  );
}
