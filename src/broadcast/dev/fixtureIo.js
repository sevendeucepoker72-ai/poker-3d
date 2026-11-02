/**
 * DEV ONLY (2026-11-02, lead spec C10): `broadcast.html?fixture=<name>` replays
 * a recorded stream from ./fixtures/<name>.json through a FAKE socket.io
 * client, so the whole real path — broadcastSocket, the program store, the
 * feed health, holeCardGate, the scenes — runs without poker-server.
 * main.jsx imports this only under `import.meta.env.DEV`, so a production
 * build never contains it or the fixtures (tests/broadcast/fixtures.test.mjs
 * greps dist for the fixtures' marker).
 *
 * Fixture times are absolute around `base`; every number within 30 days of it
 * is shifted so the snapshot's serverNow is "now". Heartbeats every 2 s
 * (stopping at `stallAfterMs` when the fixture sets it); frames at `afterMs`.
 */
const FIXTURES = import.meta.glob('./fixtures/*.json', { eager: true });
const MONTH = 30 * 24 * 3600 * 1000;

function fixtureByName(name) {
  for (const [path, mod] of Object.entries(FIXTURES)) {
    if (path.endsWith(`/${name}.json`)) return mod.default || mod;
  }
  return null;
}

function shiftTimes(value, base, delta) {
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, base, delta));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = shiftTimes(v, base, delta);
    return out;
  }
  if (typeof value === 'number' && Math.abs(value - base) < MONTH) return value + delta;
  return value;
}

export function fixtureIo(name) {
  return function io() {
    const listeners = new Map();
    const timers = [];
    const fire = (ev, ...args) => (listeners.get(ev) || []).forEach((fn) => fn(...args));
    const raw = fixtureByName(name);
    const sock = {
      connected: false,
      active: true,
      auth: {},
      on(ev, fn) { listeners.set(ev, [...(listeners.get(ev) || []), fn]); return sock; },
      removeAllListeners() { listeners.clear(); return sock; },
      connect() { return sock; },
      disconnect() { sock.connected = false; timers.forEach(clearTimeout); return sock; },
      emit(ev, payload, ack) {
        if (ev !== 'bc:subscribe' || typeof ack !== 'function') return sock;
        if (!raw) { ack({ ok: false, code: 'channel_unknown' }); return sock; }
        const delta = Date.now() - raw.snapshot.serverNow;
        const snap = shiftTimes(raw.snapshot, raw.base, delta);
        const delayMs = snap.feed && snap.feed.mode === 'delayed' ? snap.feed.delayMs : 0;
        let seq = snap.seq;
        ack({ ok: true, snapshot: snap });
        for (const f of raw.frames || []) {
          timers.push(setTimeout(() => {
            seq += 1;
            fire('bc:frame', { v: 1, seq, at: Date.now(), ...shiftTimes(f.msg, raw.base, delta) });
          }, f.afterMs));
        }
        const started = Date.now();
        const beat = setInterval(() => {
          if (raw.stallAfterMs && Date.now() - started > raw.stallAfterMs) return;
          fire('bc:heartbeat', { seq, serverNow: Date.now(), programNow: Date.now() - delayMs, delayMs, onAir: true });
        }, 2000);
        timers.push(beat);
        return sock;
      },
    };
    setTimeout(() => {
      sock.connected = true;
      if (!raw) console.warn(`[broadcast] DEV fixture "${name}" not found`);
      fire('connect');
    }, 30);
    return sock;
  };
}
