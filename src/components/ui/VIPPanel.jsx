import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore, vipPassActive } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import { VIP_PASS_PERKS, VIP_XP_TIERS, VIP_EMOTES, vipXpTierFor, shopErrorText, formatReward } from '../../utils/economyCatalog';
import { denverMonthKey, nextDenverMonthStartMs, formatCountdown } from '../../utils/denverTime';
import './VIPPanel.css';

// 2026-10-11 (.online R2 — C8 / ECON-7 / APPUI-33). Two separate things, both
// real:
//  1. The VIP PASS (bought in the Shop, timed): while active it grants exactly
//     the perks in VIP_PASS_PERKS — VIP badge + gold nameplate frame at tables,
//     +50% daily login reward, a monthly chip bonus claimed here once per
//     Denver month (claimVipMonthly), and the VIP emotes. Nothing else.
//  2. The XP-RATE TIER (Bronze → Platinum by cumulative season XP, totalXp):
//     every player has one; it multiplies XP earned. That is its only perk.
// The panel used to list perks that never existed (priority matchmaking,
// custom tables, VIP-only tournaments …) and tiered by the per-level XP.

const MONTHLY_TIMEOUT_MS = 10000;

const MONTHLY_ERRORS = {
  already_claimed: 'already',
  vip_monthly_already_claimed: 'already',
  vip_required: 'Needs an active VIP pass.',
  not_vip: 'Needs an active VIP pass.',
  vip_inactive: 'Needs an active VIP pass.',
  vip_expired: 'Needs an active VIP pass.',
};

function nextMonthLabel() {
  return new Date(nextDenverMonthStartMs()).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Whether the server says this month's VIP bonus is already collected: C8
 * `vip.monthlyClaimed` for `vip.monthKey` (the Denver month it was computed in
 * — a payload from last month does not block this month's claim).
 */
function serverSaysMonthlyClaimed(vip) {
  if (!vip || typeof vip !== 'object') return false;
  if (vip.monthlyClaimed === true) return !vip.monthKey || vip.monthKey === denverMonthKey();
  if (vip.monthlyBonusClaimed === true || vip.monthlyBonusAvailable === false) return true;
  const m = vip.monthlyClaimMonth || vip.lastMonthlyClaimMonth;
  if (typeof m === 'string' && m === denverMonthKey()) return true;
  const d = vip.lastMonthlyClaimDate || vip.monthlyClaimedAt;
  if (typeof d === 'string' && d.slice(0, 7) === denverMonthKey()) return true;
  return false;
}

/**
 * The monthly VIP chip bonus: `claimVipMonthly` → `vipMonthlyClaimed
 * { success, chips, monthKey }` or { success:false, code, error } (an
 * acknowledgement callback is also honoured). The balance itself arrives in
 * the playerProgress that follows.
 */
export function useVipMonthlyClaim() {
  const progress = useProgressStore((s) => s.progress);
  const [state, setState] = useState({ phase: 'idle', text: '', month: null });
  const timerRef = useRef(null);
  const doneRef = useRef(false);

  const finish = useCallback((res) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (res && res.success) {
      const what = res.reward ? formatReward(res.reward) : (Number(res.chips) > 0 ? `${Number(res.chips).toLocaleString()} chips` : 'your VIP bonus');
      setState({ phase: 'done', text: `Collected ${what}. The next bonus opens ${nextMonthLabel()}.`, month: denverMonthKey() });
      return;
    }
    const code = res && (res.code || res.error);
    const mapped = MONTHLY_ERRORS[code];
    if (mapped === 'already') {
      setState({ phase: 'done', text: `Already collected this month — the next bonus opens ${nextMonthLabel()}.`, month: denverMonthKey() });
      return;
    }
    setState({ phase: 'error', text: mapped || shopErrorText(res, 'Could not collect the bonus — try again.'), month: null });
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onResult = (res) => finish(res);
    socket.on('vipMonthlyClaimed', onResult);
    return () => {
      socket.off('vipMonthlyClaimed', onResult);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [finish]);

  const claim = useCallback(() => {
    const socket = getSocket();
    if (!socket || !socket.connected) { setState({ phase: 'error', text: 'Not connected — try again in a moment.', month: null }); return; }
    doneRef.current = false;
    setState({ phase: 'pending', text: 'Collecting…', month: null });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (doneRef.current) return;
      doneRef.current = true;
      setState({ phase: 'error', text: 'The game server did not answer — try again.', month: null });
    }, MONTHLY_TIMEOUT_MS);
    socket.emit('claimVipMonthly', {}, (ack) => { if (ack && typeof ack === 'object') finish(ack); });
  }, [finish]);

  const active = vipPassActive(progress);
  const claimedThisMonth = (state.month && state.month === denverMonthKey()) || serverSaysMonthlyClaimed(progress?.vip);
  return { active, claimedThisMonth, state, claim };
}

/** VIP pass status + monthly bonus — shared by the panel and the Shop tab. */
export function VipPassStatus({ compact = false }) {
  const progress = useProgressStore((s) => s.progress);
  const { active, claimedThisMonth, state, claim } = useVipMonthlyClaim();
  const exp = progress?.vip?.expiresAt;
  const bonus = Number(progress?.vip?.monthlyBonus) || 0;
  const lifetime = active && exp - Date.now() > 3650 * 86400000;
  const until = active && !lifetime ? new Date(exp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return (
    <div className={`vip-pass-status ${active ? 'vip-pass-status--active' : ''} ${compact ? 'vip-pass-status--compact' : ''}`}>
      <div className="vip-pass-status-row">
        <span className="vip-pass-badge">{active ? '💎 VIP' : 'VIP'}</span>
        <span className="vip-pass-expiry">
          {active
            ? (lifetime ? 'Active — lifetime pass' : `Active until ${until} (${formatCountdown(exp)} left)`)
            : 'No VIP pass — get one in the Shop.'}
        </span>
      </div>
      {active && (
        <div className="vip-pass-monthly">
          <button
            type="button"
            className="vip-monthly-btn"
            onClick={claim}
            disabled={state.phase === 'pending' || claimedThisMonth}
          >
            {state.phase === 'pending' ? 'Collecting…' : claimedThisMonth ? 'Monthly bonus collected' : `Collect monthly VIP bonus${bonus > 0 ? ` · ${bonus.toLocaleString()} chips` : ''}`}
          </button>
          {state.text && state.phase !== 'pending' && (
            <div className={`vip-monthly-note vip-monthly-note--${state.phase}`}>{state.text}</div>
          )}
          {claimedThisMonth && !state.text && (
            <div className="vip-monthly-note">The next bonus opens {nextMonthLabel()}.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VIPPanel({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  useBackButtonClose(true, onClose);
  // Tier is by CUMULATIVE season XP (what the server applies the XP-rate perk
  // on), not the per-level `xp` that resets on every level-up.
  const seasonXp = Number(progress?.totalXp) || 0;
  const tier = vipXpTierFor(seasonXp);
  const tierIndex = VIP_XP_TIERS.indexOf(tier);
  const nextTier = tierIndex < VIP_XP_TIERS.length - 1 ? VIP_XP_TIERS[tierIndex + 1] : null;
  const progressPct = nextTier
    ? Math.min(100, Math.round(((seasonXp - tier.minXp) / (nextTier.minXp - tier.minXp)) * 100))
    : 100;
  const passActive = vipPassActive(progress);
  const serverPerks = Array.isArray(progress?.vip?.perks) ? progress.vip.perks : [];

  return createPortal(
    <div className="vip-overlay" onClick={onClose}>
      <div className="vip-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="VIP">
        <div className="vip-header">
          <div className="vip-title">VIP</div>
          <button className="vip-close" onClick={onClose}>Close</button>
        </div>

        {/* VIP pass */}
        <div className="vip-section-title">VIP pass perks</div>
        <VipPassStatus />
        <div className="vip-perk-list">
          {VIP_PASS_PERKS.map((perk) => {
            const on = passActive && (serverPerks.length === 0 || serverPerks.includes(perk.id));
            return (
              <div key={perk.id} className={`vip-perk-row ${on ? 'vip-perk-row--on' : ''}`}>
                <span className="vip-perk-icon" aria-hidden="true">{perk.icon}</span>
                <span className="vip-perk-text">{perk.text}</span>
                <span className="vip-perk-state">{on ? 'On' : 'With a pass'}</span>
              </div>
            );
          })}
        </div>
        <div className="vip-emote-row">
          VIP emotes: {VIP_EMOTES.map((e) => <span key={e.id} title={e.name} className="vip-emote">{e.icon}</span>)}
        </div>

        {/* XP-rate tier (everyone) */}
        <div className="vip-section-title">XP-rate tier</div>
        <div className="vip-current-tier" style={{ borderColor: tier.color }}>
          <div className="vip-tier-badge" style={{ background: tier.color, color: '#0a0a1a' }}>
            {tier.name}
          </div>
          <div className="vip-xp-info">
            <span className="vip-xp-value" style={{ color: tier.color }}>
              {seasonXp.toLocaleString()} season XP
            </span>
            <span className="vip-xp-rate">{tier.rate}× XP rate</span>
          </div>
          {nextTier ? (
            <div className="vip-progress-section">
              <div className="vip-progress-track">
                <div
                  className="vip-progress-fill"
                  style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${tier.color}, ${nextTier.color})` }}
                />
              </div>
              <div className="vip-progress-label">
                {(nextTier.minXp - seasonXp).toLocaleString()} XP to {nextTier.name} ({nextTier.rate}× XP)
              </div>
            </div>
          ) : (
            <div className="vip-max-tier">Top tier reached — 3× XP</div>
          )}
        </div>
        <div className="vip-tiers-list">
          {VIP_XP_TIERS.map((t, i) => {
            const isCurrent = i === tierIndex;
            const isLocked = i > tierIndex;
            return (
              <div
                key={t.name}
                className={`vip-tier-card ${isCurrent ? 'vip-tier-card-active' : ''} ${isLocked ? 'vip-tier-card-locked' : ''}`}
                style={{ borderLeftColor: t.color }}
              >
                <div className="vip-tier-card-header">
                  <span className="vip-tier-name" style={{ color: isLocked ? '#8a96b5' : t.color }}>{t.name}</span>
                  <span className="vip-tier-range">{t.minXp.toLocaleString()}+ season XP</span>
                  {isCurrent && <span className="vip-tier-current-badge">Current</span>}
                </div>
                <div className="vip-tier-perks">
                  <div className="vip-perk-item">
                    <span className="vip-perk-check" style={{ color: isLocked ? '#5b6b8f' : t.color }}>
                      {isLocked ? '\u{25CB}' : '\u{2713}'}
                    </span>
                    <span className={isLocked ? 'vip-perk-locked' : ''}>{t.rate}× XP earned</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
