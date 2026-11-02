/**
 * HealthPanel — is the show healthy (lead spec C6, 2026-11-02): this panel's
 * connection, the age of the last producer state, OBS subscribers per layout
 * and output sessions on the channel, server on-air, the delay buffer depth,
 * and the hand on air vs the live hand.
 */
import { agoText, onAirVsLive, isObj } from './producerModel.js';

export default function HealthPanel({ hello, channelRow, state, stateAgeMs, conn }) {
  const sub = isObj(channelRow) && isObj(channelRow.subscribers) ? channelRow.subscribers : {};
  const live = isObj(state) && isObj(state.live) ? state.live : null;
  const bufferMs = live && Number.isFinite(live.bufferMs) ? live.bufferMs : null;
  const stale = !Number.isFinite(stateAgeMs) || stateAgeMs > 6000;
  const vs = onAirVsLive(state);
  return (
    <div className="bcp-card">
      <div className="bcp-card__title">Health</div>
      <div className="bcp-kv"><span>Panel</span><b>{conn && conn.connected ? 'Connected' : `Not connected${conn && conn.refused ? ` (${conn.refused})` : ''}`}</b></div>
      <div className={`bcp-kv${stale ? ' bcp-kv--amber' : ''}`}>
        <span>Last state</span>
        <b>{Number.isFinite(stateAgeMs) ? agoText(stateAgeMs) : 'none yet'}</b>
      </div>
      <div className="bcp-kv">
        <span>OBS sources</span>
        <b>
          16:9 {Number(sub['16x9']) || 0}{(Number(sub['16x9']) || 0) > 0 ? ' ✓' : ''}
          {' · '}9:16 {Number(sub['9x16']) || 0}{(Number(sub['9x16']) || 0) > 0 ? ' ✓' : ''}
          {' · '}outputs {isObj(channelRow) && Number.isFinite(channelRow.outputs) ? channelRow.outputs : 0}
        </b>
      </div>
      <div className="bcp-kv"><span>Server on air</span><b>{isObj(channelRow) && channelRow.onAir ? 'Yes' : 'No'}</b></div>
      {bufferMs !== null ? <div className="bcp-kv"><span>Delay buffer</span><b>{Math.round(bufferMs / 1000)} s</b></div> : null}
      {vs ? <div className="bcp-kv"><span>Hands</span><b>{vs}</b></div> : null}
      {hello && Number.isFinite(hello.at) ? <div className="bcp-hint">Channel counts refresh every 10 s.</div> : null}
    </div>
  );
}
