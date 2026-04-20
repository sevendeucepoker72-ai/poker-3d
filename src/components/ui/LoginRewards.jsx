import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './LoginRewards.css';
import { getSocket } from '../../services/socketService';
import { useProgressStore } from '../../store/progressStore';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';

const DAILY_REWARDS = [
  { day: 1, chips: 500, stars: 0, label: '500 chips' },
  { day: 2, chips: 750, stars: 0, label: '750 chips' },
  { day: 3, chips: 1000, stars: 0, label: '1,000 chips' },
  { day: 4, chips: 1500, stars: 5, label: '1,500 chips + 5 stars' },
  { day: 5, chips: 2000, stars: 10, label: '2,000 chips + 10 stars' },
  { day: 6, chips: 3000, stars: 20, label: '3,000 chips + 20 stars' },
  { day: 7, chips: 5000, stars: 50, label: '5,000 chips + 50 stars + Mystery Box' },
];

const LS_KEY = 'app_poker_login_rewards';

function getStoredData() {
  try {
    const raw = sessionStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getInitialState() {
  const stored = getStoredData();
  const today = getTodayStr();

  if (!stored) {
    return { streak: 1, currentDay: 1, lastClaimDate: null, claimedDays: [] };
  }

  // Check if already claimed today
  if (stored.lastClaimDate === today) {
    return stored;
  }

  // Check if the streak continues (claimed yesterday)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  if (stored.lastClaimDate === yesterdayStr) {
    const nextDay = stored.currentDay >= 7 ? 1 : stored.currentDay + 1;
    return {
      streak: stored.streak + 1,
      currentDay: nextDay,
      lastClaimDate: stored.lastClaimDate,
      claimedDays: nextDay === 1 ? [] : stored.claimedDays,
    };
  }

  // Streak broken - reset
  return { streak: 1, currentDay: 1, lastClaimDate: null, claimedDays: [] };
}

export default function LoginRewards({ onClose, autoOpened, inline }) {
  // Server-authoritative streak + last claim. Seed from store hydration; falls
  // back to the legacy sessionStorage state so UI still works pre-hydration.
  const progress = useProgressStore((s) => s.progress);
  const today = getTodayStr();

  const [state, setState] = useState(() => {
    // Prefer server-hydrated data if present
    if (progress?.loginStreak != null || progress?.lastLoginClaimDate != null) {
      const streak = progress.loginStreak || 0;
      const lastClaim = progress.lastLoginClaimDate || null;
      const day = streak === 0 ? 1 : ((streak - 1) % 7) + 1;
      return {
        streak,
        currentDay: day,
        lastClaimDate: lastClaim,
        claimedDays: lastClaim === today ? [day] : [],
      };
    }
    return getInitialState();
  });

  const canClaim = state.lastClaimDate !== today;
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);

  // Hardware back-button closes the modal (not inline embed)
  useBackButtonClose(!inline && typeof onClose === 'function', onClose || (() => {}));

  // Track active listener + timeouts so unmount mid-claim doesn't leak a
  // handler on the shared socket or fire setState on an unmounted component.
  const activeListenerRef = useRef(null);
  const timeoutIdsRef = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const sock = getSocket();
      if (sock && activeListenerRef.current) {
        sock.off('dailyLoginClaimed', activeListenerRef.current);
      }
      activeListenerRef.current = null;
      timeoutIdsRef.current.forEach(clearTimeout);
      timeoutIdsRef.current.clear();
    };
  }, []);

  // Re-sync when store updates arrive from server
  useEffect(() => {
    if (progress?.loginStreak == null && progress?.lastLoginClaimDate == null) return;
    const streak = progress.loginStreak || 0;
    const lastClaim = progress.lastLoginClaimDate || null;
    const day = streak === 0 ? 1 : ((streak - 1) % 7) + 1;
    setState({
      streak,
      currentDay: day,
      lastClaimDate: lastClaim,
      claimedDays: lastClaim === today ? [day] : [],
    });
  }, [progress?.loginStreak, progress?.lastLoginClaimDate, today]);

  const handleClaim = () => {
    if (!canClaim || claiming) return;
    const socket = getSocket();
    if (!socket) return;
    setClaiming(true);
    setClaimError(null);

    // Fail-safe: if the server never responds, unblock the UI after 12s.
    const timeoutGuard = setTimeout(() => {
      timeoutIdsRef.current.delete(timeoutGuard);
      if (!mountedRef.current) return;
      if (activeListenerRef.current) {
        socket.off('dailyLoginClaimed', activeListenerRef.current);
        activeListenerRef.current = null;
      }
      setClaiming(false);
      setClaimError('Claim timed out — please try again.');
    }, 12000);
    timeoutIdsRef.current.add(timeoutGuard);

    const onResult = (res) => {
      socket.off('dailyLoginClaimed', onResult);
      if (activeListenerRef.current === onResult) activeListenerRef.current = null;
      clearTimeout(timeoutGuard);
      timeoutIdsRef.current.delete(timeoutGuard);
      if (!mountedRef.current) return;
      setClaiming(false);
      if (!res?.success) {
        setClaimError(res?.error || 'Could not claim');
        return;
      }
      // Server awarded it — update UI optimistically; store will re-sync via playerProgress
      setState((prev) => ({
        ...prev,
        streak: res.streak || prev.streak + 1,
        currentDay: res.day || prev.currentDay,
        lastClaimDate: today,
        claimedDays: [...prev.claimedDays, res.day || prev.currentDay],
      }));
    };
    activeListenerRef.current = onResult;
    socket.on('dailyLoginClaimed', onResult);
    socket.emit('claimDailyLogin');
  };

  const rewardsContent = (
    <>
      <div className="login-rewards-streak">
        <span className="streak-flame">{'\u{1F525}'}</span>
        <span className="streak-count">{state.streak} Day Streak</span>
      </div>

      <div className="login-rewards-grid">
        {DAILY_REWARDS.map((reward) => {
          const isClaimed = state.claimedDays.includes(reward.day);
          const isToday = reward.day === state.currentDay;
          const isFuture = reward.day > state.currentDay;

          let cardClass = 'reward-day-card';
          if (isClaimed) cardClass += ' reward-day-claimed';
          else if (isToday) cardClass += ' reward-day-today';
          else if (isFuture) cardClass += ' reward-day-future';

          return (
            <div key={reward.day} className={cardClass}>
              <div className="reward-day-number">Day {reward.day}</div>
              <div className="reward-day-icon">
                {isClaimed ? '\u{2705}' : reward.day === 7 ? '\u{1F381}' : '\u{1FA99}'}
              </div>
              <div className="reward-day-chips">{reward.chips.toLocaleString()}</div>
              {reward.stars > 0 && (
                <div className="reward-day-stars">+{reward.stars} stars</div>
              )}
              {reward.day === 7 && !isClaimed && (
                <div className="reward-day-bonus">Mystery Box</div>
              )}
              {isToday && canClaim && (
                <button className="reward-claim-btn" onClick={handleClaim}>
                  Claim
                </button>
              )}
              {isToday && !canClaim && (
                <div className="reward-claimed-label">Claimed!</div>
              )}
            </div>
          );
        })}
      </div>

      {autoOpened && canClaim && (
        <div className="login-rewards-hint">
          Your daily reward is ready to claim!
        </div>
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
      <div className="login-rewards-panel" onClick={(e) => e.stopPropagation()}>
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
