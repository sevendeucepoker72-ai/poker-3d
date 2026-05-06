/* PlayerAppPushBanner — 2026-05-04 unified-push phase 3
 *
 * Small persistent banner shown on americanpubpoker.online (the online
 * poker gameplay site) inviting players to install the league's player
 * app for tournament alerts, your-turn pings, and game-day reminders.
 *
 * The .online site has no push notifications of its own (audit confirmed)
 * and there's no plan to add a separate push subscription per origin.
 * Instead, we deep-link to the player app where the canonical push setup
 * lives — same user account, works across any device the player signs
 * into.
 *
 * Dismissal sticks for 60 days (longer than marketing's 30d since this
 * is a more passive nudge — players come here for gameplay, not for
 * notification setup).
 */

import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'apk_online_push_banner_dismissed_at';
// 2026-05-04 audit P2 #27 — aligned to marketing's 30d TTL (was 60d) so
// banner cadence is consistent across cross-site nudges. Documented here
// as the canonical value.
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLAYER_APP_LINK = 'https://americanpub.poker/notifications?from=online&utm_source=poker3d';

export default function PlayerAppPushBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissedAt = 0;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      dismissedAt = raw ? parseInt(raw, 10) || 0 : 0;
    } catch (_) {}
    const fresh = !dismissedAt || (Date.now() - dismissedAt > DISMISS_TTL_MS);
    setVisible(fresh);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Get tournament alerts"
      style={{
        position: 'fixed',
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        right: 12,
        zIndex: 9000,
        maxWidth: 360,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'rgba(13, 25, 41, 0.95)',
        border: '1px solid rgba(244, 197, 66, 0.5)',
        borderRadius: 12,
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        color: '#fff',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontSize: 22 }}>🔔</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: '#f4c542' }}>Live tournament alerts</div>
        <div style={{ marginTop: 2, color: 'rgba(255,255,255,0.8)' }}>
          Get game-day reminders, your-turn pings, and weekly digests in our app.
        </div>
      </div>
      <a
        href={PLAYER_APP_LINK}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          // 2026-05-04 audit P1 #21 fix — only dismiss if the new tab
          // actually opened. window.open returns null when blocked by a
          // popup blocker; in that case keep the banner visible so the
          // user can try again or copy the URL.
          try {
            const opened = window.open(PLAYER_APP_LINK, '_blank', 'noopener,noreferrer');
            if (opened) {
              e.preventDefault();
              dismiss();
            }
            // If opened === null, let the default <a> behavior run as a
            // fallback (some browsers will still open the tab from the
            // gesture-attached anchor click).
          } catch (_) {
            // Trust the anchor as fallback; don't dismiss.
          }
        }}
        style={{
          padding: '6px 14px',
          background: '#f4c542',
          color: '#0d1929',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 800,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        Set up
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 18,
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
