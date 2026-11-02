/**
 * LiveMultiview — every table of the event, LIVE (lead spec C6, 2026-11-02),
 * with a Feature button each. PUBLIC information only: the server's table
 * summaries (players, hand number, pot, ALL-IN, biggest stack, chip leader)
 * and the featured table's hand / phase / pot as text. This view draws no
 * cards of any kind — the producer never sees a live hole card.
 * `bc:producer:feature` {channel, tableId|null, lockMinutes?:0..240}.
 */
import { useState } from 'react';
import { liveTiles, FEATURE_LOCK_OPTIONS, isObj } from './producerModel.js';
import { formatChips, phaseText } from '../../broadcast/model/tableFormat.js';

export default function LiveMultiview({ state, program, channel, call }) {
  const [lock, setLock] = useState(0);
  const live = isObj(state) && isObj(state.live) ? state.live : null;
  const featured = program && isObj(program.featured) ? program.featured : null;
  const tiles = liveTiles(live, featured ? featured.tableId : null);
  const fl = live && isObj(live.featuredLive) ? live.featuredLive : null;
  return (
    <div className="bcp-card bc-producer-live">
      <div className="bcp-card__title">Live tables</div>
      {fl ? (
        <div className="bcp-kv">
          <span>Featured, live</span>
          <b>
            {Number.isInteger(fl.tableNo) ? `Table ${fl.tableNo}` : 'Table'}
            {Number.isInteger(fl.handNumber) ? ` · hand #${fl.handNumber}` : ''}
            {phaseText(fl.phase) ? ` · ${phaseText(fl.phase)}` : ''}
            {Number.isFinite(fl.pot) && fl.pot > 0 ? ` · pot ${formatChips(fl.pot)}` : ''}
          </b>
        </div>
      ) : null}
      {featured ? (
        <div className="bcp-kv">
          <span>Featured by</span>
          <b>{featured.mode === 'producer' ? 'you (locked)' : (featured.mode === 'final_table' ? 'final table' : 'auto')}{featured.reason ? ` · ${featured.reason.replace(/_/g, ' ')}` : ''}</b>
        </div>
      ) : null}
      <div className="bcp-row">
        <label className="bcp-check">
          Lock for
          <select className="bcp-input bcp-input--small" value={lock} onChange={(e) => setLock(Number(e.target.value))}>
            {FEATURE_LOCK_OPTIONS.map((m) => <option key={m} value={m}>{m ? `${m} min` : 'no lock'}</option>)}
          </select>
        </label>
        <button type="button" className="bcp-btn bcp-btn--ghost" onClick={() => call('feature', { channel, tableId: null }, 'Featured table back on auto.')}>
          Auto pick
        </button>
      </div>
      <div className="bcp-tiles">
        {tiles.map((t) => (
          <div key={t.tableId} className={`bcp-tile${t.featured ? ' bcp-tile--featured' : ''}${t.allIn ? ' bcp-tile--allin' : ''}`}>
            <div className="bcp-tile__head">
              {t.label}
              {t.chipLeaderHere ? <span className="bcp-tile__star" title="Chip leader">{'★'}</span> : null}
              {t.allIn ? <span className="bcp-badge bcp-badge--gold">All in</span> : null}
            </div>
            <div className="bcp-tile__line">{t.players !== null ? `${t.players} players` : ''}{t.handNumber !== null ? ` · #${t.handNumber}` : ''}</div>
            <div className="bcp-tile__line">Pot {formatChips(t.pot)} · big stack {formatChips(t.biggestStack)}</div>
            <button
              type="button"
              className={`bcp-btn${t.featured ? ' bcp-btn--on' : ' bcp-btn--gold'}`}
              onClick={() => call('feature', { channel, tableId: t.tableId, lockMinutes: lock }, `${t.label} is featured${lock ? ` for ${lock} min` : ''}.`)}
            >
              {t.featured ? 'Featured' : 'Feature'}
            </button>
          </div>
        ))}
        {tiles.length === 0 ? <div className="bcp-hint">No live tables yet.</div> : null}
      </div>
    </div>
  );
}
