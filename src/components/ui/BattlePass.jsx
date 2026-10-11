import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useProgressStore } from '../../store/progressStore';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import {
  BATTLE_PASS_TOTAL_TIERS as TOTAL_TIERS,
  BATTLE_PASS_XP_PER_TIER as XP_PER_TIER,
  BATTLE_PASS_PREMIUM_COST,
  BATTLE_PASS_SEASON_NAME as SEASON_NAME,
  battlePassReward,
  formatReward,
  rewardKind,
  shopErrorText,
  catalogItem,
} from '../../utils/economyCatalog';
import './BattlePass.css';

// 2026-10-11 (.online R2 — APPUI-6 / ECON-16). The Battle Pass:
// - Premium is the SERVER's entitlement (playerProgress.battlePassPremium) —
//   never a sessionStorage flag; buying it works from the lobby
//   (purchaseBattlePass with an acknowledgement) and says what happened.
// - Every tier's reward is what the server grants (economyCatalog
//   battlePassReward — the premium milestones are real, rendered cosmetics).
// - Claims go one at a time (the server rate-limits per account) and every
//   refusal is shown on its tier (locked / premium only / slow down …).

const SEASON_ID = 'season_1_the_river';
const CLAIM_TIMEOUT_MS = 8000;

function claimErrorText(res, tier) {
  const code = res && res.error;
  if (code === 'tier_locked') {
    const unlocked = Number(res.unlockedTier);
    return Number.isFinite(unlocked) ? `Locked — you have unlocked ${unlocked} tier${unlocked === 1 ? '' : 's'} so far.` : 'Locked — earn more season XP first.';
  }
  if (code === 'premium_required') return 'Premium only — get Premium to claim it.';
  if (code === 'already_claimed') return 'Already claimed.';
  if (code === 'rate_limited') return 'Slow down — try again in a moment.';
  if (code === 'NOT_HYDRATED' || code === 'not_hydrated') return 'Your account is still loading — try again.';
  if (code === 'invalid_tier') return `Tier ${tier} is not part of this season.`;
  if (code === 'db_failed' || code === 'server_error') return 'Could not save that claim — try again.';
  return shopErrorText(res, 'Could not claim — try again.');
}

const PURCHASE_ERRORS = {
  'not in a session': 'Join a table, then try again.',
  already_premium: 'You already have Premium.',
  'already premium': 'You already have Premium.',
};

/** Buying Premium: purchaseBattlePass with an ack → { success, error }. */
export function useBattlePassPremium() {
  const premium = useProgressStore((s) => s.progress?.battlePassPremium === true);
  const stars = useProgressStore((s) => s.progress?.stars || 0);
  const [state, setState] = useState({ phase: 'idle', text: '' });
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const buy = useCallback(() => {
    const socket = getSocket();
    if (!socket || !socket.connected) { setState({ phase: 'error', text: 'Not connected — try again when the connection is back.' }); return; }
    setState({ phase: 'pending', text: 'Buying Premium…' });
    let answered = false;
    timerRef.current = setTimeout(() => {
      if (answered) return;
      answered = true;
      setState({ phase: 'error', text: 'The game server did not answer — check your stars before trying again.' });
    }, 10000);
    socket.emit('purchaseBattlePass', {}, (ack) => {
      if (answered) return;
      answered = true;
      clearTimeout(timerRef.current);
      if (ack && ack.success) {
        setState({ phase: 'done', text: 'Premium unlocked — claim your premium rewards.' });
        // The entitlement arrives in playerProgress; refresh the claim list too.
        try { socket.emit('getDurableState', { seasonId: SEASON_ID }); } catch { /* ignore */ }
        return;
      }
      const key = String(ack && ack.error || '').toLowerCase();
      setState({ phase: 'error', text: PURCHASE_ERRORS[key] || shopErrorText(ack && ack.error, 'Could not buy Premium — try again.') });
    });
  }, []);
  return { premium, stars, state, buy, cost: BATTLE_PASS_PREMIUM_COST };
}

function rewardIcon(r) {
  const k = rewardKind(r);
  if (k === 'chips') return '🪙';
  if (k === 'stars') return '⭐';
  if (k === 'xp') return '⚡';
  if (k === 'item') return catalogItem(r.itemType, r.itemId)?.icon || '🎁';
  return '🎁';
}

function rewardLabel(r) {
  if (rewardKind(r) === 'xp') return `+${r.amount} season XP`;
  const text = formatReward(r);
  return text.startsWith('the ') ? text.slice(4).replace(/^\w/, (c) => c.toUpperCase()) : text.replace(/^\w/, (c) => c.toUpperCase());
}

const TIERS = Array.from({ length: TOTAL_TIERS }, (_, i) => {
  const tier = i + 1;
  return { tier, isMilestone: tier % 10 === 0, freeReward: battlePassReward(tier, 'free'), premiumReward: battlePassReward(tier, 'premium') };
});

export default function BattlePass({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const { premium: hasPremium, stars, state: buyState, buy, cost } = useBattlePassPremium();
  // Server is the source of truth for claimed tiers (user_battle_pass_claims):
  // `${tier}:${track}` keys, hydrated by durableState.
  const claimedTiers = useMemo(() => (Array.isArray(progress?.battlePassClaimed) ? progress.battlePassClaimed.map(String) : []), [progress?.battlePassClaimed]);

  const currentXP = Number(progress?.totalXp) || 0;
  const currentTier = Math.min(TOTAL_TIERS, Math.floor(currentXP / XP_PER_TIER));
  const tierProgress = currentTier >= TOTAL_TIERS ? 100 : ((currentXP % XP_PER_TIER) / XP_PER_TIER) * 100;

  const [scrollTier, setScrollTier] = useState(() => Math.max(1, Math.min(TOTAL_TIERS - 9, currentTier - 2)));
  const visibleTiers = TIERS.slice(scrollTier - 1, scrollTier + 9);

  // Per (tier:track) claim status: { phase: 'pending' | 'done' | 'error', text }
  const [claimState, setClaimState] = useState({});
  const queueRef = useRef([]);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const [claimingAll, setClaimingAll] = useState(false);

  useBackButtonClose(true, onClose);

  const isClaimed = (tier, track) => claimedTiers.includes(`${tier}:${track}`) || claimState[`${tier}:${track}`]?.phase === 'done';

  const claimable = useMemo(() => {
    const out = [];
    for (const t of TIERS) {
      if (t.tier > currentTier) continue;
      if (!claimedTiers.includes(`${t.tier}:free`)) out.push({ tier: t.tier, track: 'free' });
      if (hasPremium && !claimedTiers.includes(`${t.tier}:premium`)) out.push({ tier: t.tier, track: 'premium' });
    }
    return out;
  }, [currentTier, claimedTiers, hasPremium]);

  // One claim at a time: the server answers battlePassTierClaimed for each.
  const pump = useCallback(() => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      if (mountedRef.current) setClaimingAll(false);
      try { getSocket()?.emit('getDurableState', { seasonId: SEASON_ID }); } catch { /* ignore */ }
      return;
    }
    const socket = getSocket();
    if (!socket || !socket.connected) {
      queueRef.current = [];
      if (mountedRef.current) {
        setClaimState((s) => ({ ...s, [`${next.tier}:${next.track}`]: { phase: 'error', text: 'Not connected — try again.' } }));
        setClaimingAll(false);
      }
      return;
    }
    busyRef.current = true;
    const key = `${next.tier}:${next.track}`;
    if (mountedRef.current) setClaimState((s) => ({ ...s, [key]: { phase: 'pending', text: 'Claiming…' } }));
    let timer = null;
    const onResult = (res) => {
      // Answers without a tier (old error shapes) belong to the claim in flight.
      if (res && res.tierId != null && Number(res.tierId) !== next.tier) return;
      if (res && res.track && res.tierId != null && res.track !== next.track) return;
      socket.off('battlePassTierClaimed', onResult);
      clearTimeout(timer);
      busyRef.current = false;
      if (mountedRef.current) {
        setClaimState((s) => ({
          ...s,
          [key]: res && res.success
            ? { phase: 'done', text: `Got ${formatReward(res.reward || battlePassReward(next.tier, next.track))}` }
            : (res && res.error === 'already_claimed' ? { phase: 'done', text: 'Already claimed' } : { phase: 'error', text: claimErrorText(res, next.tier) }),
        }));
      }
      if (res && res.error === 'rate_limited') {
        // Back off, then continue with what is left.
        setTimeout(pump, 2500);
        return;
      }
      pump();
    };
    socket.on('battlePassTierClaimed', onResult);
    timer = setTimeout(() => {
      socket.off('battlePassTierClaimed', onResult);
      busyRef.current = false;
      queueRef.current = [];
      if (mountedRef.current) {
        setClaimState((s) => ({ ...s, [key]: { phase: 'error', text: 'The game server did not answer — try again.' } }));
        setClaimingAll(false);
      }
    }, CLAIM_TIMEOUT_MS);
    // R1 — the server uses its own season; seasonId is ignored there.
    socket.emit('claimBattlePassTier', { seasonId: SEASON_ID, tierId: next.tier, track: next.track });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; queueRef.current = []; };
  }, []);

  function claimTier(tier, track = 'free') {
    if (isClaimed(tier, track)) return;
    if (queueRef.current.some((q) => q.tier === tier && q.track === track)) return;
    queueRef.current.push({ tier, track });
    pump();
  }

  function claimAll() {
    if (claimingAll || claimable.length === 0) return;
    setClaimingAll(true);
    for (const c of claimable) {
      if (!queueRef.current.some((q) => q.tier === c.tier && q.track === c.track)) queueRef.current.push(c);
    }
    pump();
  }

  const renderCellState = (tier, track, unlocked, locked) => {
    const key = `${tier}:${track}`;
    const st = claimState[key];
    const claimed = isClaimed(tier, track);
    if (claimed) return <span className="bp-claimed-badge">✓</span>;
    if (st?.phase === 'pending') return <span className="bp-claim-pending">…</span>;
    if (locked) return null;
    if (unlocked) {
      return (
        <button className={`bp-claim-btn ${track === 'premium' ? 'bp-claim-btn--premium' : ''}`} onClick={() => claimTier(tier, track)}>
          Claim
        </button>
      );
    }
    return null;
  };

  return createPortal(
    <div className="bp-overlay" onClick={onClose}>
      <div className="bp-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Battle Pass">
        {/* Header */}
        <div className="bp-header">
          <div className="bp-header-left">
            <span className="bp-season-badge">SEASON 1</span>
            <h2 className="bp-title">{SEASON_NAME}</h2>
          </div>
          <div className="bp-header-right">
            {claimable.length > 0 && (
              <button
                className="bp-claim-all-btn"
                onClick={claimAll}
                disabled={claimingAll}
                style={{ opacity: claimingAll ? 0.6 : 1, cursor: claimingAll ? 'default' : 'pointer' }}
              >
                {claimingAll ? 'Claiming…' : `Claim All (${claimable.length})`}
              </button>
            )}
            <button className="bp-close" onClick={onClose} aria-label="Close Battle Pass">✕</button>
          </div>
        </div>

        {/* Season XP bar */}
        <div className="bp-xp-bar-wrap">
          <div className="bp-xp-bar-labels">
            <span>Tier {currentTier}</span>
            <span>{currentXP.toLocaleString()} season XP · {currentTier >= TOTAL_TIERS ? 'all tiers unlocked' : `${(currentXP % XP_PER_TIER).toLocaleString()} / ${XP_PER_TIER} to next tier`}</span>
            <span>Tier {Math.min(TOTAL_TIERS, currentTier + 1)}</span>
          </div>
          <div className="bp-xp-bar">
            <div className="bp-xp-fill" style={{ width: `${tierProgress}%` }} />
          </div>
        </div>

        {/* Track headers */}
        <div className="bp-tracks-header">
          <div className="bp-track-label bp-track-free">FREE</div>
          <div className="bp-track-tiers-spacer" />
          <div className={`bp-track-label bp-track-premium ${hasPremium ? 'bp-track-premium--owned' : ''}`}>
            PREMIUM {hasPremium ? <span className="bp-upgrade-hint">• Unlocked</span> : <span className="bp-upgrade-hint">• Upgrade</span>}
          </div>
        </div>

        {/* Tier rows */}
        <div className="bp-tier-scroll">
          {visibleTiers.map(({ tier, freeReward, premiumReward, isMilestone }) => {
            const unlocked = tier <= currentTier;
            const freeSt = claimState[`${tier}:free`];
            const premSt = claimState[`${tier}:premium`];
            const freeClaimed = isClaimed(tier, 'free');
            const premiumClaimed = isClaimed(tier, 'premium');
            return (
              <div key={tier} className={`bp-tier-row ${isMilestone ? 'bp-tier-row--milestone' : ''} ${unlocked ? 'bp-tier-row--unlocked' : ''}`}>
                {/* Free reward */}
                <div className={`bp-reward-cell bp-reward-free ${unlocked ? 'bp-reward--unlocked' : ''} ${freeClaimed ? 'bp-reward--claimed' : ''}`}>
                  <span className="bp-reward-icon">{rewardIcon(freeReward)}</span>
                  <span className="bp-reward-label">{rewardLabel(freeReward)}</span>
                  {renderCellState(tier, 'free', unlocked, false)}
                  {freeSt?.phase === 'error' && <span className="bp-claim-error">{freeSt.text}</span>}
                </div>

                {/* Tier number */}
                <div className={`bp-tier-num ${tier === currentTier ? 'bp-tier-num--current' : ''} ${isMilestone ? 'bp-tier-num--milestone' : ''}`}>
                  {isMilestone ? <span className="bp-milestone-star">★</span> : null}
                  {tier}
                </div>

                {/* Premium reward */}
                <div className={`bp-reward-cell bp-reward-premium ${hasPremium && unlocked ? 'bp-reward--unlocked' : ''} ${premiumClaimed && hasPremium ? 'bp-reward--claimed' : ''} ${!hasPremium ? 'bp-reward--locked' : ''}`}>
                  {!hasPremium && <span className="bp-lock-icon">🔒</span>}
                  <span className="bp-reward-icon">{rewardIcon(premiumReward)}</span>
                  <span className="bp-reward-label">{rewardLabel(premiumReward)}</span>
                  {renderCellState(tier, 'premium', unlocked, !hasPremium)}
                  {premSt?.phase === 'error' && <span className="bp-claim-error">{premSt.text}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scroll controls */}
        <div className="bp-scroll-controls">
          <button className="bp-scroll-btn" disabled={scrollTier <= 1} onClick={() => setScrollTier(t => Math.max(1, t - 10))}>◀ Previous</button>
          <span className="bp-scroll-info">Tiers {scrollTier}–{Math.min(TOTAL_TIERS, scrollTier + 9)}</span>
          <button className="bp-scroll-btn" disabled={scrollTier + 9 >= TOTAL_TIERS} onClick={() => setScrollTier(t => Math.min(TOTAL_TIERS - 9, t + 10))}>Next ▶</button>
        </div>

        {/* Upgrade CTA */}
        {!hasPremium && (
          <div className="bp-upgrade-cta">
            <div className="bp-upgrade-text">
              <strong>Upgrade to Premium</strong>
              <span>Unlocks the premium track: card back, emote, table theme, frame and title cosmetics plus chips and stars — {cost.toLocaleString()} Stars (you have {stars.toLocaleString()}).</span>
              {buyState.text && <span className={`bp-buy-note bp-buy-note--${buyState.phase}`}>{buyState.text}</span>}
            </div>
            <button className="bp-upgrade-btn" onClick={buy} disabled={buyState.phase === 'pending'}>
              {buyState.phase === 'pending' ? 'Buying…' : `⭐ Go Premium · ${cost.toLocaleString()} Stars`}
            </button>
          </div>
        )}
        {hasPremium && buyState.phase === 'done' && (
          <div className="bp-buy-note bp-buy-note--done" style={{ textAlign: 'center', marginTop: 8 }}>{buyState.text}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
