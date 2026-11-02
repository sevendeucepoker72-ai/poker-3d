// A fake socket.io-client `io` for the broadcast socket / runtime tests.
// Records every io() call, every emit, and lets a test fire server events.
export function makeFakeIo() {
  const sockets = [];
  function io(url, opts) {
    const listeners = new Map();
    const sock = {
      url,
      opts,
      auth: opts && opts.auth ? { ...opts.auth } : {},
      connected: false,
      active: true,
      emits: [],
      connects: 0,
      disconnects: 0,
      on(ev, fn) { listeners.set(ev, [...(listeners.get(ev) || []), fn]); return sock; },
      removeAllListeners() { listeners.clear(); return sock; },
      emit(ev, payload, ack) { sock.emits.push({ ev, payload, ack }); return sock; },
      connect() { sock.connects += 1; return sock; },
      disconnect() { sock.disconnects += 1; sock.connected = false; sock.fire('disconnect', 'io client disconnect'); return sock; },
      fire(ev, ...args) { (listeners.get(ev) || []).forEach((fn) => fn(...args)); },
      serverConnect() { sock.connected = true; sock.active = true; sock.fire('connect'); },
      lastEmit(ev) { return [...sock.emits].reverse().find((e) => e.ev === ev) || null; },
      emitsOf(ev) { return sock.emits.filter((e) => e.ev === ev); },
    };
    sockets.push(sock);
    return sock;
  }
  io.sockets = sockets;
  return io;
}

// Manual timers: setTimeout / clearTimeout / setInterval replacements a test advances.
export function makeTimers() {
  let now = 1_000_000;
  let id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { id += 1; timers.set(id, { fn, at: now + ms, every: null }); return id; },
    setInterval(fn, ms) { id += 1; timers.set(id, { fn, at: now + ms, every: ms }); return id; },
    clearTimeout(t) { timers.delete(t); },
    clearInterval(t) { timers.delete(t); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [k, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [k, t];
        if (!next) break;
        const [k, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(k);
        t.fn();
      }
      now = end;
    },
    pending() { return timers.size; },
  };
}
