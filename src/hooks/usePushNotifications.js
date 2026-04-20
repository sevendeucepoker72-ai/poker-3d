/**
 * usePushNotifications — PWA push notification hook for americanpubpoker.online.
 * Full server-backed enrollment flow: permission → VAPID fetch → subscribe →
 * POST to master API. Mirrors the player-app pwa.js pattern so both apps share
 * the same backend and VAPID key.
 */

const MASTER_API =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MASTER_API_URL) ||
  'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS Safari only allows push inside an installed PWA. */
export function isIosNonStandalone() {
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const standalone =
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return isIos && !standalone;
}

export async function requestPushPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

/**
 * Enable push notifications for the given user. Returns true on success.
 * Fetches VAPID key from master API, subscribes via the service worker, and
 * POSTs the subscription to the master API so the server can send pushes.
 */
export async function subscribeToPush(userId) {
  try {
    if (!isPushSupported() || !userId) return false;
    const permission = await requestPushPermission();
    if (permission !== 'granted') return false;

    const reg = await navigator.serviceWorker.ready;

    const keyRes = await fetch(`${MASTER_API}/notifications/vapid-key`);
    if (!keyRes.ok) return false;
    const { publicKey } = await keyRes.json();
    if (!publicKey) return false;

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(publicKey),
    });

    const res = await fetch(`${MASTER_API}/notifications/push-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, subscription: subscription.toJSON() }),
    });
    return res.ok;
  } catch (e) {
    console.error('[push] subscribe failed:', e);
    return false;
  }
}

/** Disable push notifications for the given user. */
export async function unsubscribeFromPush(userId) {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    if (userId) {
      await fetch(`${MASTER_API}/notifications/push-unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    }
    return true;
  } catch (e) {
    console.error('[push] unsubscribe failed:', e);
    return false;
  }
}

/** Current enable/subscription state from the server. */
export async function getPushStatus(userId) {
  if (!userId) return { push_enabled: false, has_subscription: false };
  try {
    const res = await fetch(`${MASTER_API}/notifications/push-status/${userId}`);
    return await res.json();
  } catch {
    return { push_enabled: false, has_subscription: false };
  }
}

/**
 * Compare browser push subscription against the server's record. Returns a
 * status string so callers can decide whether to show a re-enable banner.
 */
export async function checkSubscriptionHealth(userId) {
  if (!userId) return { status: 'unsupported' };
  if (!isPushSupported()) return { status: 'unsupported' };
  if (Notification.permission === 'denied') return { status: 'not_permitted' };

  try {
    const reg = await navigator.serviceWorker.ready;
    const browserSub = await reg.pushManager.getSubscription();
    const backend = await getPushStatus(userId);
    const backendHas = !!(backend && (backend.has_subscription || backend.push_enabled));

    if (!browserSub && !backendHas) return { status: 'no_subscription' };

    // Silent re-sync when the browser has a sub but the server doesn't.
    if (browserSub && !backendHas) {
      try {
        const res = await fetch(`${MASTER_API}/notifications/push-subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, subscription: browserSub.toJSON() }),
        });
        if (res.ok) return { status: 'resynced' };
      } catch (e) {
        console.warn('[push] resync failed:', e);
      }
      return { status: 'error' };
    }

    if (!browserSub && backendHas) return { status: 'needs_resubscribe' };
    return { status: 'healthy' };
  } catch (e) {
    console.warn('[push] checkSubscriptionHealth failed:', e);
    return { status: 'error' };
  }
}

/** Fire a local (non-server) notification immediately. */
export function showLocalNotification(title, body, url = '/') {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, {
      body,
      icon: '/poker-icon-192.svg',
      badge: '/poker-icon-192.svg',
      tag: 'poker-' + Date.now(),
      data: { url },
      vibrate: [200, 100, 200],
    });
  });
}

export function scheduleNotification(title, body, delayMs, url = '/') {
  if (Notification.permission !== 'granted') return;
  setTimeout(() => showLocalNotification(title, body, url), delayMs);
}

export const notify = {
  yourTurn: () => showLocalNotification('Your Turn!', "It's your turn to act — don't timeout!", '/'),
  tournamentStart: (name) =>
    showLocalNotification('Tournament Starting!', `${name} is about to begin. Get to your seat!`, '/'),
  dailyBonus: () =>
    showLocalNotification('Daily Bonus Ready! 🎁', 'Claim your free chips — come back to the table.', '/'),
  friendOnline: (name) =>
    showLocalNotification(`${name} is online`, 'Your friend just logged in and is looking for a game.', '/'),
  sessionEnd: (net) =>
    showLocalNotification(
      net >= 0 ? `+${net.toLocaleString()} chips! 🎉` : 'Session ended',
      net >= 0 ? 'Great session! Your recap is ready.' : 'Tough session. Review your recap for insights.',
      '/'
    ),
};
