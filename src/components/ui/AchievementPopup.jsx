import { useEffect } from 'react';
import { useProgressStore } from '../../store/progressStore';
import './Progression.css';

export default function AchievementPopup() {
  const notifications = useProgressStore((s) => s.notifications);
  const dismissNotification = useProgressStore((s) => s.dismissNotification);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    if (notifications.length === 0) return;

    const timers = notifications.map((n) =>
      setTimeout(() => dismissNotification(n.id), 5000)
    );

    return () => timers.forEach(clearTimeout);
  }, [notifications, dismissNotification]);

  if (notifications.length === 0) return null;

  return (
    <div className="achievement-popup-container">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`achievement-popup ${notification.type === 'achievement' ? 'achievement-type' : 'mission-type'}`}
          onClick={() => dismissNotification(notification.id)}
        >
          <div className="achievement-popup-icon">
            {notification.type === 'achievement' ? '\u{1F3C6}' : '\u{2705}'}
          </div>
          <div className="achievement-popup-content">
            <div className="achievement-popup-title">
              {notification.type === 'achievement' ? 'Achievement Unlocked!' : 'Mission Complete!'}
            </div>
            <div className="achievement-popup-name">{notification.message}</div>
            {notification.reward && (
              <div className="achievement-popup-reward">
                {notification.reward.chips > 0 && (
                  <span className="popup-reward-chips">+{notification.reward.chips.toLocaleString()} chips</span>
                )}
                {notification.reward.xp > 0 && (
                  <span className="popup-reward-xp">+{notification.reward.xp} XP</span>
                )}
                {notification.reward.stars > 0 && (
                  <span className="popup-reward-stars">+{notification.reward.stars} stars</span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
