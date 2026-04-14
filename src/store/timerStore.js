import { create } from 'zustand';

/**
 * Shared turn-timer state driven by server timestamps.
 * GameHUD writes turnStartedAt/turnTimeout from game state;
 * SeatPod reads them to render a per-player countdown ring.
 */
export const useTimerStore = create((set) => ({
  turnStartedAt: 0,      // epoch ms when the current turn started (from server)
  turnTimeout:   30000,   // turn duration in ms (from server, default 30s)
  setTurnTiming: (startedAt, timeout) => set({ turnStartedAt: startedAt, turnTimeout: timeout }),
  clearTurnTiming: () => set({ turnStartedAt: 0 }),
}));
