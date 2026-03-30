/**
 * usePushNotifications — PWA push notification hook.
 * Handles permission request, service worker subscription, and local scheduling.
 */

const VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBnAJpMEwFb6XrU4b08';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export async function requestPushPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  const result = await Notification.requestPermission();
  return result;
}

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch {
    return null;
  }
}

/** Show a local notification immediately (no server needed) */
export function showLocalNotification(title, body, url = '/') {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
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

/** Schedule a local notification N milliseconds from now */
export function scheduleNotification(title, body, delayMs, url = '/') {
  if (Notification.permission !== 'granted') return;
  setTimeout(() => showLocalNotification(title, body, url), delayMs);
}

/** Common notification helpers */
export const notify = {
  yourTurn: () => showLocalNotification('Your Turn!', "It's your turn to act — don't timeout!", '/'),
  tournamentStart: (name) => showLocalNotification('Tournament Starting!', `${name} is about to begin. Get to your seat!`, '/'),
  dailyBonus: () => showLocalNotification('Daily Bonus Ready! 🎁', 'Claim your free chips — come back to the table.', '/'),
  friendOnline: (name) => showLocalNotification(`${name} is online`, 'Your friend just logged in and is looking for a game.', '/'),
  sessionEnd: (net) => showLocalNotification(
    net >= 0 ? `+${net.toLocaleString()} chips! 🎉` : `Session ended`,
    net >= 0 ? 'Great session! Your recap is ready.' : 'Tough session. Review your recap for insights.',
    '/'
  ),
};
