import { create } from 'zustand';

/**
 * Shared turn-timer state driven by server timestamps.
 * GameHUD writes turnStartedAt/turnTimeout from game state;
 * SeatPod reads them to render a per-player countdown ring.
 *
 * R2 (P3, 2026-10-11) — the device clock is not the server's. Every gameState
 * envelope carries `_serverTs` (the server's Date.now() at send); the smallest
 * (local receipt - _serverTs) over the recent frames is the clock offset plus
 * the shortest one-way delay, so `serverNow()` = Date.now() - that offset is
 * the server's clock as closely as the client can know it. The rings and the
 * insurance countdown read serverNow(): a phone whose clock ran a few seconds
 * fast showed every turn timer (and the insurance window) seconds short.
 */
const SKEW_SAMPLES = 20;
const _samples = [];

export const useTimerStore = create((set, get) => ({
  turnStartedAt: 0,      // epoch ms when the current turn started (from server)
  turnTimeout:   30000,   // turn duration in ms (from server, default 30s)
  clockSkewMs:   0,       // local clock - server clock (estimate)
  setTurnTiming: (startedAt, timeout) => set({ turnStartedAt: startedAt, turnTimeout: timeout }),
  clearTurnTiming: () => set({ turnStartedAt: 0 }),
  noteServerTs: (serverTs) => {
    if (typeof serverTs !== 'number' || !Number.isFinite(serverTs) || serverTs <= 0) return;
    const sample = Date.now() - serverTs;
    // A sample hours off is not a clock offset (a replayed / buffered frame).
    if (Math.abs(sample) > 6 * 60 * 60 * 1000) return;
    _samples.push(sample);
    if (_samples.length > SKEW_SAMPLES) _samples.shift();
    const skew = Math.min(..._samples);
    if (Math.abs(skew - get().clockSkewMs) >= 40) set({ clockSkewMs: skew });
  },
}));

/** The server's clock (ms), from the local clock and the measured offset. */
export function serverNow() {
  return Date.now() - (useTimerStore.getState().clockSkewMs || 0);
}
