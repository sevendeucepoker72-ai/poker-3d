import React, { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../../services/socketService';
import './StakingMarketplace.css';

export default function StakingMarketplace({ playerName, chips, onClose }) {
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

  // ---- Socket setup ----
  useEffect(() => {
    if (!socket) return;

    const handleStakingUpdated = ({ offers: newOffers }) => {
      setOffers(newOffers || []);
    };

    const handleBuyResult = ({ success, error, offerId }) => {
      if (offerId) {
        setBuyStatus(prev => ({
          ...prev,
          [offerId]: success ? { success: true } : { error: error || 'Purchase failed' },
        }));
        setTimeout(() => {
          setBuyStatus(prev => {
            const next = { ...prev };
            delete next[offerId];
            return next;
          });
        }, 3000);
      }
    };

    const handleStakeCreated = ({ id }) => {
      setSellStatus('success');
      setSellForm({ tournamentId: '', totalPct: 10, pricePerPct: 100 });
      setTimeout(() => setSellStatus(null), 3000);
    };

    socket.on('stakingUpdated', handleStakingUpdated);
    socket.on('buyStakeResult', handleBuyResult);
    socket.on('stakeCreated', handleStakeCreated);

    // Request initial data
    socket.emit('getStakes');

    return () => {
      socket.off('stakingUpdated', handleStakingUpdated);
      socket.off('buyStakeResult', handleBuyResult);
      socket.off('stakeCreated', handleStakeCreated);
    };
  }, [socket]);

  // ---- Buy action ----
  const handleBuy = useCallback((offer) => {
    const pct = parseFloat(buyAmounts[offer.id]);
    if (!pct || pct < 1 || pct > offer.remaining) return;
    setBuyStatus(prev => ({ ...prev, [offer.id]: { pending: true } }));
    socket.emit('buyStake', { offerId: offer.id, pct, buyerName: playerName });
  }, [socket, buyAmounts, playerName]);

  // ---- Sell action ----
  const handleSell = useCallback((e) => {
    e.preventDefault();
    const { tournamentId, totalPct, pricePerPct } = sellForm;
    if (!tournamentId.trim()) return;
    setSellStatus('pending');
    socket.emit('createStake', {
      tournamentId: tournamentId.trim(),
      totalPct: Number(totalPct),
      pricePerPct: Number(pricePerPct),
      playerName,
    });
  }, [socket, sellForm, playerName]);

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
