import { create } from 'zustand';

/**
 * The play refusal the shared <PlayRefusalNotice/> is showing, if any.
 *
 * Written only by services/playRefusal.js:reportPlayRefusal, i.e. only when
 * poker-server has just refused something the player tried to do (join a
 * table, register for a tournament or qualifier, rebuy, ...). Nothing writes
 * it on login, on a timer or on a push, so the client never announces a
 * suspension on its own (owner decision 2026-10-07).
 *
 * refusal: null | { code, message, at }
 *   code    'player_suspended' | 'login_required' | 'guest_disabled'
 *   message the server's text, verbatim
 *   at      Date.now() when reported (also the notice's React key)
 */
export const usePlayRefusalStore = create((set) => ({
  refusal: null,
  show: (refusal) => set({ refusal }),
  clear: () => set({ refusal: null }),
}));
