import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../../services/socketService';
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
// arrive on the shared 'error' event as `{message, code}` with one of these
// STABLE codes (CONTRACTS.md C5, T4 — locked in both repos'
// canonical-features.txt). The client keys on the CODE, never on the server's
// wording. Only these — or a C5 refusal — answer a pending sell; any other
// 'error' frame (an unrelated handler's "Unauthorized", a chat rate limit) is
// not about the sell and leaves "Creating…" to its real answer or the
// watchdog. A server that sends no code (before T4) is answered by the
// watchdog. Value: the detail shown after SELL_FAILED_TEXT.
const CREATE_STAKE_FAILURES = new Map([
  ['stake_sign_in_required', 'Sign in to create a staking offer.'],
  ['stake_invalid_offer', 'Invalid staking offer.'],
  ['stake_invalid_price', 'Invalid price per percent.'],
  ['stake_create_failed', 'Please try again.'],
]);

/**
 * 2026-10-09 (decision D3) — play refusals. Lobby passes the shared refusal
 * handling in as props — onPlayRefusal = playRefusal.reportPlayRefusal,
 * runPlayFlow = playRefusal.runPlayFlow, unreachableText =
 * GAME_SERVER_UNREACHABLE_TEXT — rather than this file importing
 * services/playRefusal: this component is bundled in the manual
 * 'lobby-features' chunk, and a static import here would pull the auth
 * modules (authService / authScheduler) into that chunk.
 */
export default function StakingMarketplace({
  playerName, chips, onClose,
  onPlayRefusal = NO_REFUSAL_HANDLER,
  runPlayFlow = RUN_DIRECT,
  unreachableText = UNREACHABLE_FALLBACK,
}) {
  const [activeTab, setActiveTab] = useState('browse');
  const [offers, setOffers] = useState([]);

  // Browse state
  const [buyAmounts, setBuyAmounts] = useState({}); // offerId -> pct string
  const [buyStatus, setBuyStatus] = useState({}); // offerId -> { pending, error, success }

  // Sell tab state
  const [sellForm, setSellForm] = useState({
    tournamentId: '',
    totalPct: 10,
    pricePerPct: 100,
  });
  const [sellStatus, setSellStatus] = useState(null); // null | 'pending' | 'success' | { error }

  const socket = getSocket();

  // 2026-10-09 (D3) — what is waiting on the server, outside React state so
  // the once-registered socket handlers can see it.
  const mountedRef = useRef(true);
  const pendingBuysRef = useRef(new Map()); // offerId -> watchdog timer
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

  // ---- Socket setup ----
  useEffect(() => {
    if (!socket) return;

    const handleStakingUpdated = ({ offers: newOffers }) => {
      setOffers(newOffers || []);
    };

    const handleBuyResult = (frame) => {
      const { success, error, offerId } = frame || {};
      const ids = settleBuys(offerId);
      // 2026-10-09 (D3) — a C5 play refusal (suspended / no account) goes to
      // the shared PlayRefusalNotice — with Sign In / silent recovery for
      // login_required — and the card just stops waiting (no second copy).
      if (onPlayRefusal(frame)) {
        setBuyStatus(prev => {
          const next = { ...prev };
          ids.forEach((id) => { delete next[id]; });
          return next;
        });
        return;
      }
      if (!ids.length) return;
      setBuyStatus(prev => {
        const next = { ...prev };
        ids.forEach((id) => { next[id] = success ? { success: true } : { error: error || 'Purchase failed' }; });
        return next;
      });
      setTimeout(() => {
        setBuyStatus(prev => {
          const next = { ...prev };
          ids.forEach((id) => { if (!next[id]?.pending) delete next[id]; });
          return next;
        });
      }, 3000);
    };

    const handleStakeCreated = ({ id }) => {
      settleSell();
      setSellStatus('success');
      setSellForm({ tournamentId: '', totalPct: 10, pricePerPct: 100 });
      setTimeout(() => setSellStatus(null), 3000);
    };

    // 2026-10-09 (D3) — createStake has no failure event of its own: its
    // refusals (C5) and errors arrive on 'error'. Only while a sell is
    // waiting, and only a frame that answers it (review fix): a C5 refusal —
    // shown by the shared notice (App's global 'error' handler and this one
    // see the same frame; it is handled once) — or one of createStake's own
    // failure CODES (CREATE_STAKE_FAILURES, T4). Every other 'error' frame is
    // ignored here.
    const handleServerError = (frame) => {
      if (!sellPendingRef.current) return;
      if (onPlayRefusal(frame)) { settleSell(); setSellStatus(null); return; }
      const code = typeof frame?.code === 'string' ? frame.code : '';
      if (!CREATE_STAKE_FAILURES.has(code)) return;
      settleSell();
      setSellStatus({ error: `${SELL_FAILED_TEXT} ${CREATE_STAKE_FAILURES.get(code)}` });
    };

    socket.on('stakingUpdated', handleStakingUpdated);
    socket.on('buyStakeResult', handleBuyResult);
    socket.on('stakeCreated', handleStakeCreated);
    socket.on('error', handleServerError);

    // Request initial data
    socket.emit('getStakes');

    return () => {
      socket.off('stakingUpdated', handleStakingUpdated);
      socket.off('buyStakeResult', handleBuyResult);
      socket.off('stakeCreated', handleStakeCreated);
      socket.off('error', handleServerError);
    };
  }, [socket, settleBuys, settleSell, onPlayRefusal]);

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
      setBuyStatus(prev => ({ ...prev, [offerId]: { error: unreachableText } }));
    }, STAKE_ANSWER_TIMEOUT_MS));
    setBuyStatus(prev => ({ ...prev, [offerId]: { pending: true } }));
    runPlayFlow(() => sendBuyOnce(offerId, pct), () => {
      sock.emit('buyStake', { offerId, pct, buyerName: playerName });
    });
  }, [playerName, runPlayFlow, unreachableText]);

  const handleBuy = useCallback((offer) => {
    const pct = parseFloat(buyAmounts[offer.id]);
    if (!pct || pct < 1 || pct > offer.remaining) return;
    sendBuy(offer.id, pct);
  }, [buyAmounts, sendBuy]);

  // ---- Sell action ----
  // Re-runnable like sendBuy. Any answer — stakeCreated, a refusal or an
  // error frame — or the watchdog ends "Creating…".
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
    if (!tournamentId.trim()) return;
    sendSell({
      tournamentId: tournamentId.trim(),
      totalPct: Number(totalPct),
      pricePerPct: Number(pricePerPct),
      playerName,
    });
  }, [sellForm, playerName, sendSell]);

  // ---- Helpers ----
  const totalBackers = (offer) => offer.backers?.length || 0;
  const soldPct = (offer) => offer.totalPct - offer.remaining;

  return (
    <div className="staking-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="staking-modal">
        {/* Header */}
        <div className="staking-header">
          <div>
            <h2 className="staking-title">Staking Marketplace</h2>
            <p className="staking-subtitle">
              Back players in tournaments for a % of their winnings
            </p>
          </div>
          <button className="staking-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Explainer banner */}
        <div className="staking-explainer">
          <span className="staking-explainer-icon">💡</span>
          <span>
            Players sell action (%) before tournaments. Backers receive that % of any winnings.
            Example: buy 10% of a player who wins $10,000 — you get $1,000.
          </span>
        </div>

        {/* Tabs */}
        <div className="staking-tabs">
          <button
            className={`staking-tab${activeTab === 'browse' ? ' active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            Browse Offers
          </button>
          <button
            className={`staking-tab${activeTab === 'sell' ? ' active' : ''}`}
            onClick={() => setActiveTab('sell')}
          >
            Sell My Action
          </button>
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
                offers.map(offer => {
                  const status = buyStatus[offer.id];
                  const pctSold = offer.totalPct > 0 ? (soldPct(offer) / offer.totalPct) * 100 : 0;

                  return (
                    <div className="staking-card" key={offer.id}>
                      <div className="staking-card-top">
                        <div>
                          <div className="staking-card-player">{offer.playerName}</div>
                          <div className="staking-card-tournament">{offer.tournamentId}</div>
                        </div>
                        <div className="staking-card-meta">
                          <div className="staking-badge">{offer.remaining}% left</div>
                          {totalBackers(offer) > 0 && (
                            <div className="staking-backers-count">{totalBackers(offer)} backer{totalBackers(offer) !== 1 ? 's' : ''}</div>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="staking-progress-track">
                        <div
                          className="staking-progress-fill"
                          style={{ width: `${Math.min(pctSold, 100)}%` }}
                        />
                      </div>
                      <div className="staking-progress-labels">
                        <span>{soldPct(offer)}% sold</span>
                        <span>{offer.totalPct}% total</span>
                      </div>

                      <div className="staking-price-row">
                        <span className="staking-price-label">Price per %</span>
                        <span className="staking-price-value">🪙 {offer.pricePerPct.toLocaleString()}</span>
                      </div>

                      {/* Backers list */}
                      {offer.backers && offer.backers.length > 0 && (
                        <div className="staking-backers">
                          {offer.backers.map((b, i) => (
                            <span key={i} className="staking-backer-pill">
                              {b.name} ({b.pct}%)
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Buy control */}
                      {offer.remaining > 0 && offer.playerName !== playerName && (
                        <div className="staking-buy-row">
                          <input
                            type="number"
                            className="staking-input staking-input-small"
                            min={1}
                            max={offer.remaining}
                            step={1}
                            placeholder={`1–${offer.remaining}%`}
                            value={buyAmounts[offer.id] || ''}
                            onChange={e => setBuyAmounts(prev => ({ ...prev, [offer.id]: e.target.value }))}
                          />
                          <button
                            className="staking-btn staking-btn-buy"
                            onClick={() => handleBuy(offer)}
                            disabled={status?.pending}
                          >
                            {status?.pending ? 'Buying…' : 'Buy'}
                          </button>
                        </div>
                      )}

                      {status?.success && (
                        <div className="staking-result staking-result-ok">Purchase successful!</div>
                      )}
                      {status?.error && (
                        <div className="staking-result staking-result-err">{status.error}</div>
                      )}
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

              <form className="staking-form" onSubmit={handleSell}>
                <div className="staking-field">
                  <label className="staking-label">Tournament Name / ID</label>
                  <input
                    className="staking-input"
                    type="text"
                    placeholder="e.g. Sunday Major #42"
                    value={sellForm.tournamentId}
                    onChange={e => setSellForm(f => ({ ...f, tournamentId: e.target.value }))}
                    required
                  />
                </div>

                <div className="staking-field">
                  <label className="staking-label">
                    Total % to sell &nbsp;
                    <span className="staking-label-hint">(1–50%)</span>
                  </label>
                  <div className="staking-range-row">
                    <input
                      className="staking-range"
                      type="range"
                      min={1}
                      max={50}
                      value={sellForm.totalPct}
                      onChange={e => setSellForm(f => ({ ...f, totalPct: Number(e.target.value) }))}
                    />
                    <span className="staking-range-value">{sellForm.totalPct}%</span>
                  </div>
                </div>

                <div className="staking-field">
                  <label className="staking-label">
                    Price per % &nbsp;
                    <span className="staking-label-hint">(chips)</span>
                  </label>
                  <input
                    className="staking-input"
                    type="number"
                    min={1}
                    value={sellForm.pricePerPct}
                    onChange={e => setSellForm(f => ({ ...f, pricePerPct: Number(e.target.value) }))}
                    required
                  />
                </div>

                <div className="staking-sell-summary">
                  <span>Total raise if fully sold:</span>
                  <span className="staking-sell-total">
                    🪙 {(sellForm.totalPct * sellForm.pricePerPct).toLocaleString()}
                  </span>
                </div>

                <button
                  type="submit"
                  className="staking-btn staking-btn-create"
                  disabled={sellStatus === 'pending'}
                >
                  {sellStatus === 'pending' ? 'Creating…' : 'List My Action'}
                </button>

                {sellStatus === 'success' && (
                  <div className="staking-result staking-result-ok">Offer listed successfully!</div>
                )}
                {sellStatus?.error && (
                  <div className="staking-result staking-result-err">{sellStatus.error}</div>
                )}
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
