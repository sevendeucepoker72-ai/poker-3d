/**
 * KeyManager — keys and URLs for the OBS browser sources (lead spec C6 + R3 +
 * §3 mintKey / revokeKey / listKeys, 2026-11-02).
 *
 * - Public output needs NO key: the channel URL (?ch=weekly) works week after
 *   week. Shown first, both layouts.
 * - An OUTPUT key (`ch:<channel>`, scope output) makes a source count as an
 *   on-air output (the deploy freeze and the health counts see it).
 * - A DELAYED key (P5; the event's 'q:' / 't:' key, scopes delayed + output)
 *   is what a hole-card feed needs; the server answers 'holecards_off' until
 *   the owner turns the policy on, and only an allowlisted issuer may mint one.
 * - A minted key is shown ONCE (the server never shows it again), only in the
 *   URL's #k= fragment, and only until Done; it is never stored or logged.
 * - listKeys never returns token strings; Revoke ends a key at once.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  sourceUrl, obsSetupText, delayedKeyEvent, keyRowsOf, keyTimeMs, clampTtlHours,
  CHANNEL_LABELS, KEY_MAX_TTL_HOURS,
} from './producerModel.js';
import { formatDenverWhen } from '../../utils/qualifierList.js';

function copy(text) {
  try {
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
  } catch { /* the field is selectable anyway */ }
}

function UrlRow({ label, url }) {
  if (!url) return null;
  return (
    <div className="bcp-url">
      <span className="bcp-url__label">{label}</span>
      <input className="bcp-input bcp-url__field" readOnly value={url} onFocus={(e) => e.target.select()} />
      <button type="button" className="bcp-btn bcp-btn--ghost" onClick={() => copy(url)}>Copy</button>
    </div>
  );
}

export default function KeyManager({ program, channel, call, origin, connected }) {
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState(KEY_MAX_TTL_HOURS);
  const [rows, setRows] = useState([]);
  const [minted, setMinted] = useState(null); // {token, target, scopes, exp} — shown once
  const delayedEv = delayedKeyEvent(program);

  const refresh = useCallback(async () => {
    const res = await call('listKeys', {});
    if (res && res.ok) setRows(keyRowsOf(res));
  }, [call]);

  useEffect(() => {
    if (!connected) return undefined;
    let live = true;
    call('listKeys', {}).then((res) => { if (live && res && res.ok) setRows(keyRowsOf(res)); });
    return () => { live = false; };
  }, [connected, call]);

  const mint = async (kind) => {
    const ev = kind === 'delayed' ? delayedEv : `ch:${channel}`;
    if (!ev) return;
    const scopes = kind === 'delayed' ? ['delayed', 'output'] : ['output'];
    const name = (label.trim() || `OBS ${CHANNEL_LABELS[channel] || channel}${kind === 'delayed' ? ' delayed' : ''}`).slice(0, 60);
    const res = await call('mintKey', { ev, scopes, label: name, ttlHours: clampTtlHours(ttl) }, 'Key made. Copy the URLs now: it is shown once.');
    if (res && res.ok && typeof res.token === 'string') {
      setMinted({ token: res.token, target: kind === 'delayed' ? ev : channel, scopes, exp: keyTimeMs(res.exp) });
      refresh();
    }
  };

  const revoke = async (jti) => {
    const res = await call('revokeKey', { jti }, 'Key revoked.');
    if (res && res.ok) refresh();
  };

  return (
    <div className="bcp-card">
      <div className="bcp-card__title">OBS sources and keys</div>
      <div className="bcp-sub">Public feed (no key needed)</div>
      <UrlRow label="16:9" url={sourceUrl({ origin, target: channel, layout: '16x9' })} />
      <UrlRow label="9:16" url={sourceUrl({ origin, target: channel, layout: '9x16' })} />
      <pre className="bcp-pre">{obsSetupText('16x9')}</pre>

      <div className="bcp-sub">Make a key</div>
      <div className="bcp-form">
        <input className="bcp-input" value={label} maxLength={60} placeholder="Label (e.g. OBS laptop)" onChange={(e) => setLabel(e.target.value)} />
        <label className="bcp-check">
          Hours
          <input
            className="bcp-input bcp-input--small"
            type="number"
            min={1}
            max={KEY_MAX_TTL_HOURS}
            value={ttl}
            onChange={(e) => setTtl(clampTtlHours(e.target.value))}
          />
        </label>
        <button type="button" className="bcp-btn bcp-btn--gold" onClick={() => mint('output')}>Output key</button>
        <button
          type="button"
          className="bcp-btn"
          disabled={!delayedEv}
          title={delayedEv ? `Delayed hole-card key for ${delayedEv}` : 'Bind the channel to a qualifier or tournament first'}
          onClick={() => mint('delayed')}
        >
          Delayed key
        </button>
      </div>

      {minted ? (
        <div className="bcp-token">
          <div className="bcp-token__head">Shown once. Copy these URLs into OBS now.</div>
          <UrlRow label="16:9" url={sourceUrl({ origin, target: minted.target, layout: '16x9', key: minted.token })} />
          <UrlRow label="9:16" url={sourceUrl({ origin, target: minted.target, layout: '9x16', key: minted.token })} />
          <div className="bcp-hint">
            Scopes: {minted.scopes.join(', ')}{minted.exp ? ` · expires ${formatDenverWhen(minted.exp)}` : ''}
          </div>
          <button type="button" className="bcp-btn" onClick={() => setMinted(null)}>Done</button>
        </div>
      ) : null}

      <div className="bcp-sub">
        Keys
        <button type="button" className="bcp-btn bcp-btn--ghost bcp-btn--tiny" onClick={refresh}>Refresh</button>
      </div>
      {rows.length ? (
        <div className="bcp-list">
          {rows.map((k) => (
            <div key={k.jti} className={`bcp-list__row${k.revoked ? ' bcp-list__row--off' : ''}`}>
              <span>
                <b>{k.label || k.jti.slice(0, 8)}</b>
                {' · '}{k.scopes.join(', ')}
                {k.exp ? ` · until ${formatDenverWhen(keyTimeMs(k.exp))}` : ''}
                {k.connected ? ` · ${k.connected} connected` : ''}
                {k.revoked ? ' · revoked' : ''}
              </span>
              {!k.revoked ? <button type="button" className="bcp-btn bcp-btn--ghost" onClick={() => revoke(k.jti)}>Revoke</button> : null}
            </div>
          ))}
        </div>
      ) : <div className="bcp-hint">No keys yet.</div>}
    </div>
  );
}
