import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './LoginRewards.css';
import { getSocket } from '../../services/socketService';
import { useProgressStore, dailyLoginClaimable, nextLoginRewardDay, vipPassActive } from '../../store/progressStore';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import { denverDateKey, nextDenverMidnightMs, formatCountdown } from '../../utils/denverTime';
import { formatReward, shopErrorText } from '../../utils/economyCatalog';

// 2026-10-11 (.online R2 — APPUI-36 / ECON-4). The daily login reward runs on
// the SERVER's Denver calendar: claimable when playerProgress
// .lastLoginClaimDate (Denver YYYY-MM-DD) is not today's Denver date; the day
// of the 7-day cycle the next claim pays continues only after a claim
// yesterday (Denver). The calendar used to read the browser's local date and
// a sessionStorage copy, so an evening player was offered a reward the server
// refused as already claimed (and the refusal was silent).
//
// Amounts mirror poker-server's LOGIN_CHIPS_BY_DAY / LOGIN_STARS_BY_DAY; an
// active VIP pass adds +50% (C8); Day 7 also opens a Basic Mystery Box. The
// claim answer (dailyLoginClaimed) is what was actually paid and is shown.

const DAILY_REWARDS = [
  { day: 1, chips: 1000, stars: 0 },
  { day: 2, chips: 2000, stars: 0 },
  { day: 3, chips: 3000, stars: 0 },
  { day: 4, chips: 5000, stars: 5 },
  { day: 5, chips: 7500, stars: 10 },
  { day: 6, chips: 10000, stars: 20 },
  { day: 7, chips: 20000, stars: 50, box: 'Basic Mystery Box' },
];

const CLAIM_TIMEOUT_MS = 12000;

function claimedText(res) {
  const parts = [];
  if (Number(res.chips) > 0) parts.push(`${Number(res.chips).toLocaleString()} chips`);
  if (Number(res.stars) > 0) parts.push(`${Number(res.stars).toLocaleString()} stars`);
  const box = res.mysteryReward || res.mysteryBox || res.box;
  if (box && typeof box === 'object') parts.push(`a Mystery Box: ${formatReward(box)}`);
  const d = Number(res.day);
  const head = d > 0 ? `Claimed Day ${d}` : 'Claimed';
  return parts.length ? `${head}: ${parts.join(' + ')}!` : `${head}!`;
}

export default function LoginRewards({ onClose, autoOpened, inline }) {
  const progress = useProgressStore((s) => s.progress);
  const hydrated = progress?.hydrated === true;
  const [now, setNow] = useState(() => Date.now());
  const claimable = dailyLoginClaimable(progress, now);
  const day = nextLoginRewardDay(progress, now);
  const streak = Math.max(0, Number(progress?.loginStreak) || 0);
  const vip = vipPassActive(progress, now);

  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }

  // Hardware back-button closes the modal (not inline embed)
  useBackButtonClose(!inline && typeof onClose === 'function', onClose || (() => {}));

  const activeListenerRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const iv = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      const sock = getSocket();
      if (sock && activeListenerRef.current) sock.off('dailyLoginClaimed', activeListenerRef.current);
      activeListenerRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClaim = () => {
    if (!claimable || claiming) return;
    const socket = getSocket();
    if (!socket || !socket.connected) { setMessage({ ok: false, text: 'Not connected — try again in a moment.' }); return; }
    setClaiming(true);
    setMessage(null);

    const onResult = (res) => {
      socket.off('dailyLoginClaimed', onResult);
      if (activeListenerRef.current === onResult) activeListenerRef.current = null;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (!mountedRef.current) return;
      setClaiming(false);
      // The server's own Denver claim date when it sends one (R2), else today's.
      const sentDate = typeof res?.lastLoginClaimDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(res.lastLoginClaimDate) ? res.lastLoginClaimDate.slice(0, 10) : null;
      const today = sentDate || denverDateKey();
      if (res?.success) {
        // The server recorded today's claim (its ledger date is Denver's):
        // reflect exactly that until its playerProgress arrives.
        useProgressStore.getState().setProgress({
          lastLoginClaimDate: today,
          ...(Number.isFinite(Number(res.streak)) ? { loginStreak: Number(res.streak) } : {}),
        });
        setMessage({ ok: true, text: claimedText(res) });
        return;
      }
      if (res?.error === 'already_claimed' || res?.code === 'already_claimed') {
        useProgressStore.getState().setProgress({ lastLoginClaimDate: today });
        setMessage({ ok: true, text: 'Already claimed today — your next reward opens at midnight (Denver time).' });
        return;
      }
      setMessage({ ok: false, text: shopErrorText(res, 'Could not claim — try again.') });
    };
    activeListenerRef.current = onResult;
    socket.on('dailyLoginClaimed', onResult);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      socket.off('dailyLoginClaimed', onResult);
      activeListenerRef.current = null;
      if (!mountedRef.current) return;
      setClaiming(false);
      setMessage({ ok: false, text: 'The game server did not answer — try again.' });
    }, CLAIM_TIMEOUT_MS);
    socket.emit('claimDailyLogin');
  };

  const shownStreak = claimable ? (day === 1 ? 0 : streak) : streak;
  const rewardsContent = (
    <>
      <div className="login-rewards-streak">
        <span className="streak-flame">{'\u{1F525}'}</span>
        <span className="streak-count">{shownStreak} Day Streak</span>
        {vip && <span className="login-rewards-vip">VIP +50%</span>}
      </div>

      {!hydrated ? (
        <div className="login-rewards-hint">Loading your rewards…</div>
      ) : (
        <div className="login-rewards-grid">
          {DAILY_REWARDS.map((reward) => {
            const isToday = reward.day === day;
            const isClaimed = reward.day < day || (isToday && !claimable);
            const isFuture = reward.day > day;
            let cardClass = 'reward-day-card';
            if (isClaimed) cardClass += ' reward-day-claimed';
            else if (isToday) cardClass += ' reward-day-today';
            else if (isFuture) cardClass += ' reward-day-future';
            return (
              <div key={reward.day} className={cardClass}>
                <div className="reward-day-number">Day {reward.day}</div>
                <div className="reward-day-icon">
                  {isClaimed ? '\u{2705}' : reward.box ? '\u{1F381}' : '\u{1F4B0}'}
                </div>
                <div className="reward-day-chips">{reward.chips.toLocaleString()}</div>
                {reward.stars > 0 && <div className="reward-day-stars">+{reward.stars} stars</div>}
                {reward.box && <div className="reward-day-bonus">+ {reward.box}</div>}
                {isToday && claimable && (
                  <button className="reward-claim-btn" onClick={handleClaim} disabled={claiming}>
                    {claiming ? 'Claiming…' : 'Claim'}
                  </button>
                )}
                {isToday && !claimable && <div className="reward-claimed-label">Claimed!</div>}
              </div>
            );
          })}
        </div>
      )}

      {message && (
        <div className={`login-rewards-message ${message.ok ? 'login-rewards-message--ok' : ''}`}>{message.text}</div>
      )}
      {hydrated && !claimable && !message && (
        <div className="login-rewards-hint">Next reward in {formatCountdown(nextDenverMidnightMs(now), now)} (midnight, Denver time).</div>
      )}
      {autoOpened && claimable && !message && (
        <div className="login-rewards-hint">Your daily reward is ready to claim!</div>
      )}
    </>
  );

  // Inline mode: render directly without overlay/portal
  if (inline) {
    return (
      <div className="login-rewards-panel login-rewards-inline">
        {rewardsContent}
      </div>
    );
  }

  return createPortal(
    <div className="login-rewards-overlay" onClick={onClose}>
      <div className="login-rewards-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Daily login rewards">
        <div className="login-rewards-header">
          <div className="login-rewards-title">Daily Login Rewards</div>
          <button className="login-rewards-close" onClick={onClose}>Close</button>
        </div>
        {rewardsContent}
      </div>
    </div>,
    document.body
  );
}
