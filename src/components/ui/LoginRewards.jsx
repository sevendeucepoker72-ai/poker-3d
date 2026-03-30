import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './LoginRewards.css';

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
    const raw = localStorage.getItem(LS_KEY);
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
  const [state, setState] = useState(getInitialState);
  const today = getTodayStr();
  const canClaim = state.lastClaimDate !== today;

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  const handleClaim = () => {
    if (!canClaim) return;
    setState((prev) => ({
      ...prev,
      lastClaimDate: today,
      claimedDays: [...prev.claimedDays, prev.currentDay],
    }));
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
