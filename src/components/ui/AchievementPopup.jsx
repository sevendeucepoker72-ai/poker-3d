import { useEffect, useRef } from 'react';
import { useProgressStore } from '../../store/progressStore';
import { acceptTableInvite, acceptClubChallengeNotice } from '../../services/tableInviteJoin';
import { inviteJoinRequest } from '../../utils/tableInvite';
import './Progression.css';

// 2026-10-11 (R2, APPUI P3) — every toast is titled by what it is. The popup
// used to title EVERY toast that was not an achievement "Mission Complete!"
// (purchases, invites, table moves, maintenance…). A toast carries its own
// `title` (App.jsx); without one it is titled by its type, never as a mission
// or an achievement it is not.
const DEFAULT_TITLES = {
  reward: 'Reward',
  purchase: 'Shop',
  friend: 'Friends',
  tournament: 'Tournament',
  system: 'Notice',
};
const ICONS = {
  achievement_unlocked: '\u{1F3C6}',
  mission_complete: '\u{1F3AF}',
  reward: '\u{1F381}',
  purchase: '\u{1F6CD}',
  friend: '\u{1F465}',
  tournament: '\u{1F3C6}',
  system: '\u{1F514}',
};

export function toastTitle(n) {
  if (!n) return 'Notice';
  if (typeof n.title === 'string' && n.title.trim()) return n.title.trim();
  if (n.kind === 'achievement_unlocked') return 'Achievement Unlocked!';
  if (n.kind === 'mission_complete') return 'Mission Complete!';
  return DEFAULT_TITLES[n.type] || 'Notice';
}

function toastIcon(n) {
  return ICONS[n.kind] || ICONS[n.type] || '\u{1F514}';
}

const TOAST_MS = 5000;
// Gameplay audit F141 — a toast may ask to stay up longer (`durationMs`, e.g.
// a club challenge's 3-minute join window); capped at 5 minutes.
const toastMs = (n) => {
  const d = Number(n && n.durationMs);
  return Number.isFinite(d) && d > TOAST_MS ? Math.min(d, 300000) : TOAST_MS;
};

export default function AchievementPopup() {
  const notifications = useProgressStore((s) => s.notifications);
  const dismissNotification = useProgressStore((s) => s.dismissNotification);
  // One timer per toast, started when it first shows — a new toast no longer
  // restarts the others' timers (a burst used to keep them all on screen).
  const timersRef = useRef(new Map());

  // Accept a table invite: join the inviter's table (seat auto-assign, -1).
  // R3 (K3-2 / S1-5 / CLUBS-5, contract I1) — routed by the invite's tableKind
  // (a home game through its invite code, a club table through the club, a
  // cash table through joinTable); the table opens once the seat is
  // confirmed, and a refused Join is said in a toast (services/tableInviteJoin).
  // C3 fix-up (F145 / F141) — the toast closes only when the Join went ahead.
  // `false` = he cancelled the "leaves the table you are playing" confirm (or
  // the socket was down, said in its own toast): the invite / challenge stays
  // up for the rest of its window, so "not yet — let me finish this hand"
  // never throws it away. (A Join that threw still closes it, as before.)
  const joinWentAhead = (accept, notification) => {
    try { return accept(notification) !== false; } catch { return true; }
  };
  const acceptInvite = (notification) => {
    if (joinWentAhead(acceptTableInvite, notification)) dismissNotification(notification.id);
  };
  // Gameplay audit F141 — a club challenge accepted while he plays another
  // table (or in a background tab) is a notice, joined only on this tap.
  const acceptChallenge = (notification) => {
    if (joinWentAhead(acceptClubChallengeNotice, notification)) dismissNotification(notification.id);
  };

  useEffect(() => {
    const timers = timersRef.current;
    const live = new Set(notifications.map((n) => n.id));
    for (const n of notifications) {
      if (timers.has(n.id)) continue;
      timers.set(n.id, setTimeout(() => {
        timers.delete(n.id);
        dismissNotification(n.id);
      }, toastMs(n)));
    }
    for (const [id, t] of timers) {
      if (!live.has(id)) { clearTimeout(t); timers.delete(id); }
    }
  }, [notifications, dismissNotification]);

  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
  }, []);

  if (notifications.length === 0) return null;

  // Cap visible toasts at 3 — if more are in the queue, the older ones have
  // already auto-dismissed; this just prevents a freak burst from painting 20
  // stacked popups and covering the whole screen mid-hand.
  const visible = notifications.slice(-3);

  return (
    // pointerEvents:'none' on the wrapper so the entire container can't swallow
    // clicks to the game UI (check/call/raise buttons) — only the individual
    // toasts opt back into clicks.
    <div className="achievement-popup-container" style={{ pointerEvents: 'none' }}>
      {visible.map((notification) => (
        <div
          key={notification.id}
          className={`achievement-popup ${notification.kind === 'achievement_unlocked' ? 'achievement-type' : 'mission-type'} toast-kind-${notification.kind || notification.type || 'notice'}`}
          onClick={() => dismissNotification(notification.id)}
          style={{ pointerEvents: 'auto' }}
        >
          <div className="achievement-popup-icon">{toastIcon(notification)}</div>
          <div className="achievement-popup-content">
            <div className="achievement-popup-title">{toastTitle(notification)}</div>
            <div className="achievement-popup-name">{String(notification.message ?? '')}</div>
            {inviteJoinRequest(notification) && (
              <button
                className="achievement-popup-invite-join"
                onClick={(e) => { e.stopPropagation(); acceptInvite(notification); }}
                style={{ pointerEvents: 'auto' }}
              >
                Join Table
              </button>
            )}
            {notification.challengeTableId != null && (
              <button
                className="achievement-popup-invite-join achievement-popup-challenge-join"
                onClick={(e) => { e.stopPropagation(); acceptChallenge(notification); }}
                style={{ pointerEvents: 'auto' }}
              >
                Join challenge
              </button>
            )}
            {notification.reward && (
              <div className="achievement-popup-reward">
                {Number(notification.reward.chips) > 0 && (
                  <span className="popup-reward-chips">+{Number(notification.reward.chips).toLocaleString()} chips</span>
                )}
                {Number(notification.reward.xp) > 0 && (
                  <span className="popup-reward-xp">+{Number(notification.reward.xp).toLocaleString()} XP</span>
                )}
                {Number(notification.reward.stars) > 0 && (
                  <span className="popup-reward-stars">+{Number(notification.reward.stars).toLocaleString()} stars</span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
