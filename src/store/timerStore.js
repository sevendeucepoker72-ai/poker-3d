import { create } from 'zustand';

/**
 * Shared turn-timer state.
 * GameHUD writes here; PokerTable / SeatNameplate reads here.
 */
export const useTimerStore = create((set) => ({
  timerLeft:  30,   // seconds remaining
  timerTotal: 30,   // total seconds for this turn (reset each turn)
  setTimerLeft:  (v) => set({ timerLeft: v }),
  setTimerTotal: (v) => set({ timerTotal: v }),
  resetTimer: (total = 30) => set({ timerLeft: total, timerTotal: total }),
}));
