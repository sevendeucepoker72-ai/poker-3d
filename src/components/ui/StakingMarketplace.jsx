import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSocket } from '../../services/socketService';
import { useGameStore } from '../../store/gameStore';
import { useTournamentRegistrationStore } from '../../store/tournamentRegistrationStore';
import { normalizeStakeableTournaments, isOwnStakeOffer, createStakePayload } from '../../utils/staking';
import './StakingMarketplace.css';

// 2026-10-09 (decision D3) — no answer at all within this long: stop the
// spinner and say so, instead of leaving "Buying…" / "Creating…" up forever.
const STAKE_ANSWER_TIMEOUT_MS = 15_000;
// Fallbacks when rendered without Lobby's props (see the component doc).
const NO_REFUSAL_HANDLER = () => false;
const RUN_DIRECT = (_replay, run) => run();
const UNREACHABLE_FALLBACK = "Couldn't reach the game server — please try again.";
// Headline of every sell failure shown under the form.
const SELL_FAILED_TEXT = 'Could not list your offer.';
// createStake has no failure event: besides a C5 refusal, its own failures
// arrive on the shared 'error' event as `{message, code}` with a STABLE code
// (CONTRACTS.md C5, T4; R2 C4 adds the tournament checks). The client keys on
// the CODE, never on the server's wording: a known code shows this detail, any
// other `stake_*` code (a newer server) shows the server's own sentence. Any
// other 'error' frame is not about the sell and leaves "Creating…" to its real
// answer or the watchdog.
const CREATE_STAKE_FAILURES = new Map([
  ['stake_sign_in_required', 'Sign in to create a staking offer.'],
  ['stake_invalid_offer', 'Invalid staking offer.'],
  ['stake_invalid_price', 'Invalid price per percent.'],
  ['stake_create_failed', 'Please try again.'],
]);
// This account's own offers (ids from `stakeCreated`) and backings, per tab.
const MY_OFFERS_KEY = 'poker_my_stake_offers_v1';
const MY_STAKES_KEY = 'poker_my_stakes_v1';

export const STAKE_ESCROW_TEXT = 'Your chips are held in escrow until the tournament ends. You get your share of the player\'s winnings; you are refunded if the tournament is cancelled, the player does not play or unregisters, or busts before the money.';
export const STAKE_NO_TOURNAMENT_TEXT = 'You can sell action only in a tournament you are registered for. Register for an upcoming tournament first, then come back here.';

function readOwned(key, owner) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (parsed && owner && parsed.owner === owner) return parsed.items || (Array.isArray(parsed.ids) ? parsed.ids : []);
  } catch { /* ignore */ }
  return [];
}
function writeOwned(key, owner, payload) {
  try { if (owner) sessionStorage.setItem(key, JSON.stringify({ owner, ...payload })); } catch { /* ignore */ }
}

const OFFER_STATUS_LABELS = {
  open: null,
  escrow: 'In escrow',
  active: 'In escrow',
  running: 'Tournament running — chips in escrow',
  settled: 'Settled',
  paid: 'Settled',
  refunded: 'Refunded to backers',
  cancelled: 'Cancelled — backers refunded',
};

function formatWhen(t) {
  if (t == null) return '';
  try { return new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

/**
 * 2026-10-09 (decision D3) — play refusals. Lobby passes the shared refusal
 * handling in as props — onPlayRefusal = playRefusal.reportPlayRefusal,
 * runPlayFlow = playRefusal.runPlayFlow, unreachableText =
 * GAME_SERVER_UNREACHABLE_TEXT.
 *
 * R2 (contract C4, 2026-10-11 — APPUI-22 / TOURNEY-8): a sale is for a
 * tournament the seller is REGISTERED in, picked from the server's
 * `myStakeableTournaments` (request `getStakeableTournaments`) — no free-text
 * tournament name any more (backers of a typed name were never paid).
 * createStake sends `{ tournamentId, percent, pricePerPercent }` (+ the older
 * totalPct / pricePerPct names for a pre-C4 server). A backer's chips are in
 * ESCROW until settlement and refunded on cancel / no-show / bust before the
 * money / unregister. The Buy control is hidden for the account's OWN offers by
 * account (server `isMine` / seller id, or an offer this tab created) — never
 * by display name.
 */
export default function StakingMarketplace({
  chips, onClose,
  onPlayRefusal = NO_REFUSAL_HANDLER,
  runPlayFlow = RUN_DIRECT,
  unreachableText = UNREACHABLE_FALLBACK,
}) {
  const userId = useGameStore((s) => s.userId);
  const owner = userId != null ? String(userId) : null;
  const knownTournaments = useTournamentRegistrationStore((s) => s.tournaments);
  const [activeTab, setActiveTab] = useState('browse');
  const [offers, setOffers] = useState([]);

  // Browse state
  const [buyAmounts, setBuyAmounts] = useState({}); // offerId -> pct string
  const [buyStatus, setBuyStatus] = useState({}); // offerId -> { pending, error, success }

  // Sell tab state
  const [stakeable, setStakeable] = useState(null); // null = not answered yet
  const [sellForm, setSellForm] = useState({ tournamentId: '', totalPct: 10, pricePerPct: 100 });
  const [sellStatus, setSellStatus] = useState(null); // null | 'pending' | 'success' | { error }

  // This account's own offer ids + backings (escrow / paid), this tab only.
  const [myOfferIds, setMyOfferIds] = useState(() => new Set(readOwned(MY_OFFERS_KEY, owner).map(String)));
  const [myStakes, setMyStakes] = useState(() => readOwned(MY_STAKES_KEY, owner));
  useEffect(() => {
    setMyOfferIds(new Set(readOwned(MY_OFFERS_KEY, owner).map(String)));
    setMyStakes(readOwned(MY_STAKES_KEY, owner));
  }, [owner]);

  const socket = getSocket();

  // 2026-10-09 (D3) — what is waiting on the server, outside React state so
  // the once-registered socket handlers can see it.
  const mountedRef = useRef(true);
  const pendingBuysRef = useRef(new Map()); // offerId -> watchdog timer
  const pendingBuyInfoRef = useRef(new Map()); // offerId -> { pct, cost, sellerName, tournamentId, tournamentName }
  const sellPendingRef = useRef(null);      // null | { timer }
  useEffect(() => {
    mountedRef.current = true;
    const pendingBuys = pendingBuysRef.current;
    return () => {
      mountedRef.current = false;
      pendingBuys.forEach((t) => clearTimeout(t));
      pendingBuys.clear();
      if (sellPendingRef.current) clearTimeout(sellPendingRef.current.timer);
      sellPendingRef.current = null;
    };
  }, []);

  const tournamentName = useCallback((tournamentId, offer) => {
    if (offer?.tournamentName) return String(offer.tournamentName);
    const id = tournamentId != null ? String(tournamentId) : '';
    const fromSell = (stakeable || []).find((t) => t.tournamentId === id);
    if (fromSell) return fromSell.name;
    const known = (knownTournaments || []).find((t) => String(t.tournamentId) === id);
    return known?.name || 'Tournament';
  }, [stakeable, knownTournaments]);

  // Settle the buy cards a buyStakeResult answers: its offerId (the server
  // echoes it on every frame, D3) — or, for a frame without one (an older
  // server), every card still waiting. Returns the offer ids settled.
  const settleBuys = useCallback((offerId) => {
    const pending = pendingBuysRef.current;
    const ids = offerId ? [offerId] : Array.from(pending.keys());
    ids.forEach((id) => {
      const t = pending.get(id);
      if (t) clearTimeout(t);
      pending.delete(id);
    });
    return ids;
  }, []);

  const settleSell = useCallback(() => {
    const cur = sellPendingRef.current;
    if (!cur) return false;
    clearTimeout(cur.timer);
    sellPendingRef.current = null;
    return true;
  }, []);

  const recordStake = useCallback((entry) => {
    setMyStakes((prev) => {
      const next = [entry, ...prev.filter((s) => s.key !== entry.key)].slice(0, 30);
      writeOwned(MY_STAKES_KEY, owner, { items: next });
      return next;
    });
  }, [owner]);

  // ---- Socket setup ----
  useEffect(() => {
    if (!socket) return undefined;

    const handleStakingUpdated = (data) => {
      setOffers(Array.isArray(data?.offers) ? data.offers : []);
    };

    const handleBuyResult = (frame) => {
      const { success, error, offerId } = frame || {};
      const ids = settleBuys(offerId);
      // A C5 play refusal (suspended / no account) goes to the shared
      // PlayRefusalNotice and the card just stops waiting (no second copy).
      if (onPlayRefusal(frame)) {
        setBuyStatus((prev) => {
          const next = { ...prev };
          ids.forEach((id) => { delete next[id]; });
          return next;
        });
        return;
      }
      if (!ids.length) return;
      if (success) {
        ids.forEach((id) => {
          const info = pendingBuyInfoRef.current.get(id);
          if (info) recordStake({ key: `${id}:${Date.now()}`, offerId: id, ...info, status: 'escrow', at: Date.now() });
          pendingBuyInfoRef.current.delete(id);
        });
      }
      setBuyStatus((prev) => {
        const next = { ...prev };
        ids.forEach((id) => { next[id] = success ? { success: true } : { error: error || 'Purchase failed' }; });
        return next;
      });
      setTimeout(() => {
        setBuyStatus((prev) => {
          const next = { ...prev };
          ids.forEach((id) => { if (!next[id]?.pending) delete next[id]; });
          return next;
        });
      }, 4000);
    };

    const handleStakeCreated = (data) => {
      settleSell();
      if (data?.id != null) {
        setMyOfferIds((prev) => {
          const next = new Set(prev); next.add(String(data.id));
          writeOwned(MY_OFFERS_KEY, owner, { ids: [...next].slice(-50) });
          return next;
        });
      }
      setSellStatus('success');
      setSellForm((f) => ({ ...f, totalPct: 10, pricePerPct: 100 }));
      setTimeout(() => setSellStatus(null), 3000);
    };

    // createStake answers its failures on 'error' (C5 refusal or a stake_*
    // code). Only while a sell is waiting, and only a frame that answers it.
    const handleServerError = (frame) => {
      if (!sellPendingRef.current) return;
      if (onPlayRefusal(frame)) { settleSell(); setSellStatus(null); return; }
      const code = typeof frame?.code === 'string' ? frame.code : '';
      if (!code.startsWith('stake_')) return;
      settleSell();
      const detail = CREATE_STAKE_FAILURES.get(code) || (typeof frame?.message === 'string' && frame.message ? frame.message : 'Please try again.');
      setSellStatus({ error: `${SELL_FAILED_TEXT} ${detail}` });
    };

    const handleStakeable = (payload) => setStakeable(normalizeStakeableTournaments(payload));

    // A tournament you backed paid out (existing server event).
    const handlePayout = (data) => {
      const tid = data?.tournamentId != null ? String(data.tournamentId) : null;
      setMyStakes((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          if (s.status !== 'escrow' || (tid && s.tournamentId !== tid)) return s;
          changed = true;
          return { ...s, status: 'paid', paid: Number(data?.amount) || 0 };
        });
        if (changed) writeOwned(MY_STAKES_KEY, owner, { items: next });
        return changed ? next : prev;
      });
    };

    socket.on('stakingUpdated', handleStakingUpdated);
    socket.on('buyStakeResult', handleBuyResult);
    socket.on('stakeCreated', handleStakeCreated);
    socket.on('error', handleServerError);
    socket.on('myStakeableTournaments', handleStakeable);
    socket.on('stakingPayout', handlePayout);

    // Request initial data
    socket.emit('getStakes');
    socket.emit('getStakeableTournaments');

    return () => {
      socket.off('stakingUpdated', handleStakingUpdated);
      socket.off('buyStakeResult', handleBuyResult);
      socket.off('stakeCreated', handleStakeCreated);
      socket.off('error', handleServerError);
      socket.off('myStakeableTournaments', handleStakeable);
      socket.off('stakingPayout', handlePayout);
    };
  }, [socket, settleBuys, settleSell, onPlayRefusal, owner, recordStake]);

  // The sell list again whenever the Sell tab opens (a registration since).
  useEffect(() => {
    if (activeTab !== 'sell') return;
    getSocket()?.emit('getStakeableTournaments');
  }, [activeTab]);

  // Keep the picked tournament valid (first one by default).
  useEffect(() => {
    if (!stakeable) return;
    setSellForm((f) => (stakeable.some((t) => t.tournamentId === f.tournamentId) ? f
      : { ...f, tournamentId: stakeable[0]?.tournamentId || '' }));
  }, [stakeable]);

  // ---- Buy action ----
  // Re-runnable: the play-refusal replay (services/playRefusal.js) calls it
  // once more after silently re-authenticating a signed-in tab that was
  // refused login_required. A watchdog stops "Buying…" if nothing answers.
  const sendBuy = useCallback(function sendBuyOnce(offerId, pct) {
    if (!mountedRef.current) return;
    const sock = getSocket();
    if (!sock) return;
    const pending = pendingBuysRef.current;
    if (pending.has(offerId)) clearTimeout(pending.get(offerId));
    pending.set(offerId, setTimeout(() => {
      if (!pendingBuysRef.current.has(offerId)) return;
      pendingBuysRef.current.delete(offerId);
      if (!mountedRef.current) return;
      setBuyStatus((prev) => ({ ...prev, [offerId]: { error: unreachableText } }));
    }, STAKE_ANSWER_TIMEOUT_MS));
    setBuyStatus((prev) => ({ ...prev, [offerId]: { pending: true } }));
    runPlayFlow(() => sendBuyOnce(offerId, pct), () => {
      sock.emit('buyStake', { offerId, pct });
    });
  }, [runPlayFlow, unreachableText]);

  const handleBuy = useCallback((offer) => {
    const pct = parseFloat(buyAmounts[offer.id]);
    if (!pct || pct < 1 || pct > offer.remaining) return;
    pendingBuyInfoRef.current.set(offer.id, {
      pct,
      cost: Math.round(pct * (Number(offer.pricePerPct) || 0)),
      sellerName: offer.playerName ? String(offer.playerName) : 'Player',
      tournamentId: offer.tournamentId != null ? String(offer.tournamentId) : null,
      tournamentName: tournamentName(offer.tournamentId, offer),
    });
    sendBuy(offer.id, pct);
  }, [buyAmounts, sendBuy, tournamentName]);

  // ---- Sell action ----
  const sendSell = useCallback(function sendSellOnce(payload) {
    if (!mountedRef.current) return;
    const sock = getSocket();
    if (!sock) return;
    if (sellPendingRef.current) clearTimeout(sellPendingRef.current.timer);
    sellPendingRef.current = {
      timer: setTimeout(() => {
        if (!sellPendingRef.current) return;
        sellPendingRef.current = null;
        if (mountedRef.current) setSellStatus({ error: unreachableText });
      }, STAKE_ANSWER_TIMEOUT_MS),
    };
    setSellStatus('pending');
    runPlayFlow(() => sendSellOnce(payload), () => {
      sock.emit('createStake', payload);
    });
  }, [runPlayFlow, unreachableText]);

  const handleSell = useCallback((e) => {
    e.preventDefault();
    const { tournamentId, totalPct, pricePerPct } = sellForm;
    if (!tournamentId || !(stakeable || []).some((t) => t.tournamentId === tournamentId)) return;
    sendSell(createStakePayload({ tournamentId, percent: totalPct, pricePerPercent: pricePerPct }));
  }, [sellForm, stakeable, sendSell]);

  // ---- Helpers ----
  const totalBackers = (offer) => offer.backers?.length || 0;
  const soldPct = (offer) => offer.totalPct - offer.remaining;
  const ownCheck = useMemo(() => ({ userId, myOfferIds }), [userId, myOfferIds]);

  return (
    <div className="staking-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="staking-modal">
        {/* Header */}
        <div className="staking-header">
          <div>
            <h2 className="staking-title">Staking Marketplace</h2>
            <p className="staking-subtitle">Back players in tournaments for a % of their winnings</p>
          </div>
          <button className="staking-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Explainer banner */}
        <div className="staking-explainer">
          <span className="staking-explainer-icon">💡</span>
          <span>
            Players sell action (%) in tournaments they are registered for. Backers receive that % of the player's
            winnings — buy 10% of a player who wins 10,000 chips and you get 1,000 chips. {STAKE_ESCROW_TEXT}
          </span>
        </div>

        {/* Tabs */}
        <div className="staking-tabs">
          <button className={`staking-tab${activeTab === 'browse' ? ' active' : ''}`} onClick={() => setActiveTab('browse')}>Browse Offers</button>
          <button className={`staking-tab${activeTab === 'sell' ? ' active' : ''}`} onClick={() => setActiveTab('sell')}>Sell My Action</button>
          <button className={`staking-tab${activeTab === 'mine' ? ' active' : ''}`} onClick={() => setActiveTab('mine')}>My Stakes</button>
        </div>

        {/* Content */}
        <div className="staking-content">
          {activeTab === 'browse' && (
            <div className="staking-offers">
              {offers.length === 0 ? (
                <div className="staking-empty">
                  <span>No offers available right now.</span>
                  <span className="staking-empty-sub">Check back soon or create your own offer.</span>
                </div>
              ) : (
                offers.map((offer) => {
                  const status = buyStatus[offer.id];
                  const pctSold = offer.totalPct > 0 ? (soldPct(offer) / offer.totalPct) * 100 : 0;
                  const mine = isOwnStakeOffer(offer, ownCheck);
                  const stateLabel = OFFER_STATUS_LABELS[String(offer.status || '').toLowerCase()] || null;
                  const buyable = !mine && offer.remaining > 0 && (!offer.status || String(offer.status).toLowerCase() === 'open');
                  return (
                    <div className={`staking-card${mine ? ' staking-card--mine' : ''}`} key={offer.id}>
                      <div className="staking-card-top">
                        <div style={{ minWidth: 0 }}>
                          <div className="staking-card-player">
                            {String(offer.playerName ?? 'Player')}
                            {mine && <span className="staking-mine-badge">Your offer</span>}
                          </div>
                          <div className="staking-card-tournament">
                            {tournamentName(offer.tournamentId, offer)}
                            {offer.startsAt ? ` · ${formatWhen(typeof offer.startsAt === 'number' ? offer.startsAt : Date.parse(offer.startsAt))}` : ''}
                          </div>
                        </div>
                        <div className="staking-card-meta">
                          <div className="staking-badge">{offer.remaining}% left</div>
                          {totalBackers(offer) > 0 && (
                            <div className="staking-backers-count">{totalBackers(offer)} backer{totalBackers(offer) !== 1 ? 's' : ''}</div>
                          )}
                        </div>
                      </div>

                      {stateLabel && <div className="staking-state-line">{stateLabel}</div>}

                      {/* Progress bar */}
                      <div className="staking-progress-track">
                        <div className="staking-progress-fill" style={{ width: `${Math.min(pctSold, 100)}%` }} />
                      </div>
                      <div className="staking-progress-labels">
                        <span>{soldPct(offer)}% sold</span>
                        <span>{offer.totalPct}% total</span>
                      </div>

                      <div className="staking-price-row">
                        <span className="staking-price-label">Price per %</span>
                        <span className="staking-price-value">🪙 {Number(offer.pricePerPct || 0).toLocaleString()}</span>
                      </div>

                      {/* Backers list */}
                      {offer.backers && offer.backers.length > 0 && (
                        <div className="staking-backers">
                          {offer.backers.map((b, i) => (
                            <span key={i} className="staking-backer-pill">{String(b?.name ?? 'Player')} ({b?.pct}%)</span>
                          ))}
                        </div>
                      )}

                      {/* Buy control — never on the account's own offer */}
                      {buyable && (
                        <div className="staking-buy-row">
                          <input
                            type="number"
                            inputMode="numeric"
                            className="staking-input staking-input-small"
                            min={1}
                            max={offer.remaining}
                            step={1}
                            placeholder={`1–${offer.remaining}%`}
                            value={buyAmounts[offer.id] || ''}
                            onChange={(e) => setBuyAmounts((prev) => ({ ...prev, [offer.id]: e.target.value }))}
                          />
                          <button className="staking-btn staking-btn-buy" onClick={() => handleBuy(offer)} disabled={status?.pending}>
                            {status?.pending ? 'Buying…' : 'Buy'}
                          </button>
                        </div>
                      )}
                      {buyable && Number(buyAmounts[offer.id]) > 0 && (
                        <div className="staking-cost-line">
                          Cost: 🪙 {Math.round(Number(buyAmounts[offer.id]) * (Number(offer.pricePerPct) || 0)).toLocaleString()} — held in escrow until the tournament settles
                        </div>
                      )}

                      {status?.success && <div className="staking-result staking-result-ok">Backed! Your chips are in escrow until the tournament settles.</div>}
                      {status?.error && <div className="staking-result staking-result-err">{status.error}</div>}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'sell' && (
            <div className="staking-sell">
              <div className="staking-sell-info">
                <strong>Your chips:</strong> 🪙 {chips?.toLocaleString() ?? 0}
              </div>

              {stakeable === null && <div className="staking-empty"><span>Loading your tournaments…</span></div>}
              {stakeable !== null && stakeable.length === 0 && (
                <div className="staking-empty staking-no-tournament">
                  <span>{STAKE_NO_TOURNAMENT_TEXT}</span>
                </div>
              )}

              {stakeable !== null && stakeable.length > 0 && (
                <form className="staking-form" onSubmit={handleSell}>
                  <div className="staking-field">
                    <label className="staking-label" htmlFor="staking-tournament">Tournament you are registered in</label>
                    <select
                      id="staking-tournament"
                      className="staking-input staking-select"
                      value={sellForm.tournamentId}
                      onChange={(e) => setSellForm((f) => ({ ...f, tournamentId: e.target.value }))}
                      required
                    >
                      {stakeable.map((t) => (
                        <option key={t.tournamentId} value={t.tournamentId}>
                          {t.name}{t.startsAt ? ` — ${formatWhen(t.startsAt)}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="staking-field">
                    <label className="staking-label">
                      Total % to sell &nbsp;<span className="staking-label-hint">(1–50%)</span>
                    </label>
                    <div className="staking-range-row">
                      <input
                        className="staking-range"
                        type="range"
                        min={1}
                        max={50}
                        value={sellForm.totalPct}
                        onChange={(e) => setSellForm((f) => ({ ...f, totalPct: Number(e.target.value) }))}
                      />
                      <span className="staking-range-value">{sellForm.totalPct}%</span>
                    </div>
                  </div>

                  <div className="staking-field">
                    <label className="staking-label">
                      Price per % &nbsp;<span className="staking-label-hint">(chips)</span>
                    </label>
                    <input
                      className="staking-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={sellForm.pricePerPct}
                      onChange={(e) => setSellForm((f) => ({ ...f, pricePerPct: Number(e.target.value) }))}
                      required
                    />
                  </div>

                  <div className="staking-sell-summary">
                    <span>Total raise if fully sold:</span>
                    <span className="staking-sell-total">🪙 {(sellForm.totalPct * sellForm.pricePerPct).toLocaleString()}</span>
                  </div>
                  <div className="staking-cost-line">Backers' chips stay in escrow until the tournament settles; they are refunded if you unregister, do not play, or bust before the money.</div>

                  <button type="submit" className="staking-btn staking-btn-create" disabled={sellStatus === 'pending' || !sellForm.tournamentId}>
                    {sellStatus === 'pending' ? 'Creating…' : 'List My Action'}
                  </button>

                  {sellStatus === 'success' && <div className="staking-result staking-result-ok">Offer listed successfully!</div>}
                  {sellStatus?.error && <div className="staking-result staking-result-err">{sellStatus.error}</div>}
                </form>
              )}
            </div>
          )}

          {activeTab === 'mine' && (
            <div className="staking-offers">
              {myStakes.length === 0 ? (
                <div className="staking-empty">
                  <span>You have not backed anyone from this device yet.</span>
                  <span className="staking-empty-sub">Backed players appear here with their escrow status.</span>
                </div>
              ) : myStakes.map((s) => (
                <div className="staking-card" key={s.key}>
                  <div className="staking-card-top">
                    <div style={{ minWidth: 0 }}>
                      <div className="staking-card-player">{s.sellerName}</div>
                      <div className="staking-card-tournament">{s.tournamentName || 'Tournament'}</div>
                    </div>
                    <div className="staking-card-meta"><div className="staking-badge">{s.pct}%</div></div>
                  </div>
                  <div className="staking-state-line">
                    {s.status === 'paid'
                      ? `Settled — paid 🪙 ${Number(s.paid || 0).toLocaleString()}`
                      : `In escrow — 🪙 ${Number(s.cost || 0).toLocaleString()} until the tournament settles`}
                  </div>
                </div>
              ))}
              <div className="staking-cost-line">{STAKE_ESCROW_TEXT}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
