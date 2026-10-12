/**
 * Server-wide flags the client learns from broadcasts (R2, 2026-10-11 —
 * APPUI-34). Dependency-free.
 *
 * Maintenance: poker-server emits `maintenanceMode { enabled }` to every
 * socket on each admin toggle, and `{ enabled: true }` to a socket at its
 * connection while maintenance is on (it says nothing at connection when it
 * is off). So: a (re)connect resets the flag to OFF, and every announcement
 * sets it. The admin dashboard's toggle reads this (it used to start at OFF
 * every time it opened, whatever the server's state, and flipped it locally
 * before the server answered).
 */
let maintenance = false;
const subscribers = new Set();

function publish() {
  for (const fn of [...subscribers]) {
    try { fn(maintenance); } catch { /* ignore */ }
  }
}

export function noteMaintenanceMode(enabled) {
  const next = !!enabled;
  if (next === maintenance) return;
  maintenance = next;
  publish();
}

/** A new connection: OFF until the server announces otherwise. */
export function noteServerConnected() {
  noteMaintenanceMode(false);
}

export function getMaintenanceMode() {
  return maintenance;
}

export function subscribeMaintenanceMode(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
