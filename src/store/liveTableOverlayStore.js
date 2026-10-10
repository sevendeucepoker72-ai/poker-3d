import { create } from 'zustand';

/**
 * liveTableOverlayStore — how many overlays that put LIVE tables on screen are
 * open over the lobby right now (2026-10-09; today only the multi-table view,
 * opened from Lobby). The one-time guest carry-over prompt
 * (components/ui/GuestCarryOverPrompt.jsx) is lobby-only and waits while this
 * is > 0, so it is never drawn over play.
 *
 * Deliberately its own tiny store with no app imports: Lobby is a lazy chunk,
 * and importing services/guestCarryOver from it (that module pulls in the
 * socket re-auth + play-refusal modules) re-split the entry chunk.
 */
export const useLiveTableOverlayStore = create((set) => ({
  open: 0,
  _bump: (delta) => set((st) => ({ open: Math.max(0, (st.open || 0) + delta) })),
}));

/** Mark a live-table overlay open; returns the function that closes it. */
export function openLiveTableOverlay() {
  let closed = false;
  try { useLiveTableOverlayStore.getState()._bump(1); } catch { /* ignore */ }
  return () => {
    if (closed) return;
    closed = true;
    try { useLiveTableOverlayStore.getState()._bump(-1); } catch { /* ignore */ }
  };
}
