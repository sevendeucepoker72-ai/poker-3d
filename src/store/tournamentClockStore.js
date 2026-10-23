import { create } from 'zustand';

/**
 * tournamentClockStore (2026-10-22, review fix-up of the table HUD clock) —
 * when this tab last received the server's 'tournamentResumed' EVENT, per
 * tournament (local Date.now()). The held-table state (the prestart / break /
 * pause banner, with Deal now hidden) is read from gameState.tournamentClock;
 * a server may resume without broadcasting a gameState (poker-server's
 * pauseTournament emits the event and only schedules the next hand), so
 * GameHUD treats a resume newer than the clock frame as "not held"
 * (utils/tournamentClock.js resumedClock): the Deal now escape hatch comes
 * back instead of a table stuck on "Paused by the tournament director".
 * A later 'tournamentPaused' clears the mark (the last frame applies again).
 * Memory only; App.jsx's socket handlers write it.
 */
export const useTournamentClockStore = create((set) => ({
  resumedAt: {}, // tournamentId -> local ms of the last 'tournamentResumed'
  noteTournamentResumed: (data, now = Date.now()) => {
    const id = data?.tournamentId;
    if (id == null || id === '') return;
    set((s) => ({ resumedAt: { ...s.resumedAt, [String(id)]: now } }));
  },
  noteTournamentPaused: (data) => {
    const id = data?.tournamentId;
    if (id == null || id === '') return;
    set((s) => {
      if (!(String(id) in s.resumedAt)) return s;
      const next = { ...s.resumedAt };
      delete next[String(id)];
      return { resumedAt: next };
    });
  },
}));
