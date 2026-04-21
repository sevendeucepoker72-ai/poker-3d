import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '../../services/socketService';
import './AchievementsPanel.css';

/**
 * AchievementsPanel — three-tab panel showing Daily / Weekly / Lifetime
 * achievements with unlock status, reward preview, and a live countdown
 * timer on Daily/Weekly tabs. Server-authoritative: loads via
 * `getAchievements` socket event and updates on `achievementsList`.
 */
export default function AchievementsPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState('daily');
  const [data, setData] = useState({
    daily: [], weekly: [], lifetime: [],
    windowEndsAt: { daily: 0, weekly: 0 },
  });
  const [now, setNow] = useState(Date.now());

  // Fetch once on mount, refetch if user switches tabs after a long idle.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onList = (payload) => {
      if (!payload) return;
      setData({
        daily: Array.isArray(payload.daily) ? payload.daily : [],
        weekly: Array.isArray(payload.weekly) ? payload.weekly : [],
        lifetime: Array.isArray(payload.lifetime) ? payload.lifetime : [],
        windowEndsAt: payload.windowEndsAt || { daily: 0, weekly: 0 },
      });
    };
    socket.on('achievementsList', onList);
    socket.emit('getAchievements');
    // Also refetch whenever a new achievement is unlocked so the
    // panel reflects the state instantly without reopening.
    const onUnlocked = () => socket.emit('getAchievements');
    socket.on('achievementUnlocked', onUnlocked);
    return () => {
      socket.off('achievementsList', onList);
      socket.off('achievementUnlocked', onUnlocked);
    };
  }, []);

  // 1Hz tick for the countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const endsAt = activeTab === 'daily'
    ? data.windowEndsAt?.daily
    : activeTab === 'weekly'
    ? data.windowEndsAt?.weekly
    : 0;

  const list = data[activeTab] || [];
  const totalUnlocked = useMemo(
    () => list.filter((a) => a.unlocked).length,
    [list],
  );
  const totalStars = useMemo(
    () => list.reduce((s, a) => s + (a.reward?.stars || 0), 0),
    [list],
  );
  const earnedStars = useMemo(
    () => list.filter((a) => a.unlocked).reduce((s, a) => s + (a.reward?.stars || 0), 0),
    [list],
  );

  return (
    <div className="ach-overlay" onClick={onClose}>
      <div className="ach-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ach-header">
          <h2 className="ach-title">🏆 Achievements</h2>
          <button className="ach-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ach-tabs" role="tablist">
          {[
            { key: 'daily',    label: 'Daily' },
            { key: 'weekly',   label: 'Weekly' },
            { key: 'lifetime', label: 'Lifetime' },
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              className={`ach-tab ${activeTab === t.key ? 'ach-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ach-stats-row">
          <span className="ach-stat">
            <strong>{totalUnlocked}</strong> / {list.length} earned
          </span>
          <span className="ach-stat ach-stat--stars">
            ⭐ <strong>{earnedStars.toLocaleString()}</strong> / {totalStars.toLocaleString()}
          </span>
          {endsAt > 0 && (activeTab === 'daily' || activeTab === 'weekly') && (
            <span className="ach-stat ach-stat--countdown">
              Resets in {formatCountdown(endsAt - now)}
            </span>
          )}
        </div>

        <div className="ach-list">
          {list.length === 0 && (
            <div className="ach-empty">No achievements yet — come back after a hand.</div>
          )}
          {list.map((a) => (
            <AchievementRow key={a.id} ach={a} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AchievementRow({ ach }) {
  const cls = `ach-row ${ach.unlocked ? 'ach-row--unlocked' : ''}`;
  const r = ach.reward || {};
  return (
    <div className={cls}>
      <div className="ach-icon" aria-hidden>
        {ach.unlocked ? '✓' : '·'}
      </div>
      <div className="ach-body">
        <div className="ach-name">{ach.name}</div>
        <div className="ach-desc">{ach.description}</div>
      </div>
      <div className="ach-reward">
        {r.stars ? <span className="rw-stars">⭐ {r.stars}</span> : null}
        {r.chips ? <span className="rw-chips">🪙 {r.chips.toLocaleString()}</span> : null}
        {r.xp    ? <span className="rw-xp">{r.xp} XP</span> : null}
      </div>
    </div>
  );
}

function formatCountdown(ms) {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
