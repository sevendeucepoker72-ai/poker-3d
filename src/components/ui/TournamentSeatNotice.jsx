import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  useTournamentSeatStore, dismissTournamentNotice, clearSeatRestored, setTournamentBannerBottom,
  dismissAwaySeat, TOURNAMENT_ABSENT_LIMP_NOTE,
} from '../../store/tournamentSeatStore';
import { useGameStore } from '../../store/gameStore';
import {
  returnToTournament, TOURNAMENT_SEAT_NOT_FOUND_TEXT,
  TOURNAMENT_RETURN_OFFLINE_TEXT, TOURNAMENT_RETURN_AT_TABLE_TEXT,
} from '../../services/tournamentReturn';

export { TOURNAMENT_SEAT_NOT_FOUND_TEXT, TOURNAMENT_RETURN_OFFLINE_TEXT, TOURNAMENT_RETURN_AT_TABLE_TEXT };

/**
 * 2026-10-10 (S2) — leaving a tournament table, and coming back.
 *
 * A LIVE tournament seat is never stood up by "Back to Lobby" / "Customize
 * Avatar": poker-server keeps it in play as ABSENT (blinds posted from the
 * stack, never cashed out) and tells the socket ('tournamentSeatKept').
 * Round 6 (P-i): an absent seat is FOLDED, except that it may check, or call
 * at most one big blind when everyone else still in the hand is absent too —
 * every line that says "folded for you" adds "we may check or limp the
 * blind for you" (TOURNAMENT_ABSENT_LIMP_NOTE). TournamentLeaveDialog says so
 * before he leaves (GameHUD), and TournamentReturnBanner offers "Return to
 * tournament" in the lobby (services/tournamentReturn: socket
 * 'returnToTournamentSeat' with an ack — protocol P-c / P-c''; after a Return
 * that got no answer at all — an older server — that seat's row also offers
 * Dismiss). SeatRestoredBanner: a seat the server restored in the background
 * (a reconnect) while the player was in the avatar customizer — the screen is
 * not switched; the banner offers the table.
 * Blue + gold, never red (owner preference).
 */

const CARD_STYLE = {
  boxSizing: 'border-box',
  borderRadius: 14,
  background: 'linear-gradient(135deg, rgba(12,28,72,0.98), rgba(8,18,48,0.98))',
  border: '1px solid rgba(255,210,74,0.55)',
  boxShadow: '0 10px 36px rgba(0,0,0,0.6)',
  color: '#e8eefc',
  textAlign: 'center',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
};
const GOLD_BUTTON = {
  padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, #ffd24a, #e6b422)', color: '#0a1628', fontWeight: 700, fontSize: 14,
};
const BLUE_BUTTON = {
  padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
  background: 'transparent', color: '#cfe0ff', border: '1px solid rgba(120,160,255,0.45)', fontSize: 14,
};

// P-i (round 6): "folded for you" is true except for the check / one-big-blind
// limp an absent seat may make when everyone left in the hand is absent too.
export const TOURNAMENT_LEAVE_TEXT = `You stay registered. While you are away your hand is folded for you (${TOURNAMENT_ABSENT_LIMP_NOTE}) and your blinds are posted from your stack. Tap Return to tournament in the lobby to take your seat back.`;

/**
 * Shown over the table before the player leaves a LIVE tournament seat.
 * `via` — 'lobby' | 'customizer' (what he tapped).
 */
export function TournamentLeaveDialog({ name, via, onStay, onLeave }) {
  return (
    <div
      className="tournament-leave-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Leave the tournament table"
      style={{
        position: 'fixed', inset: 0, zIndex: 10060,
        background: 'rgba(4,10,28,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{ ...CARD_STYLE, width: 'min(92vw, 400px)', padding: '20px 20px 18px' }}>
        <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 17, lineHeight: 1.35 }}>
          {via === 'customizer' ? 'Customize your avatar?' : 'Leave the tournament table?'}
        </div>
        <div style={{ marginTop: 6, fontSize: 13.5, color: '#cfe0ff', fontWeight: 600 }}>
          {name || 'Your tournament'}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.5, color: '#e8eefc' }}>
          {TOURNAMENT_LEAVE_TEXT}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" style={BLUE_BUTTON} onClick={onStay}>Stay at the table</button>
          <button type="button" style={GOLD_BUTTON} onClick={onLeave}>
            {via === 'customizer' ? 'Go to avatar' : 'Go to lobby'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lobby banner: "Return to tournament" for every seat the player is away
 * from (usually one), and a closing line when one ended. Return =
 * services/tournamentReturn.returnToTournament (P-c): the server answers on
 * the ack / 'returnToTournamentResult' and, on success, has already sent
 * 'reconnectedToTable' + a full gameState (App.jsx switches to the table).
 * The client never pre-refuses: the server's `already_seated` answer is the
 * authority on whether the socket plays at another table.
 */
export function TournamentReturnBanner() {
  const awaySeats = useTournamentSeatStore((s) => s.awaySeats);
  const returning = useTournamentSeatStore((s) => s.returning);
  const notice = useTournamentSeatStore((s) => s.notice);
  const noticeKind = useTournamentSeatStore((s) => s.noticeKind);
  const noticeKey = useTournamentSeatStore((s) => s.noticeKey);
  const mounted = useRef(true);
  const bannerRef = useRef(null);
  useEffect(() => () => { mounted.current = false; }, []);
  const visible = awaySeats.length > 0 || !!notice;
  // Round 3 — the banner is fixed at the top of the lobby: it reports its
  // bottom edge (store bannerBottom) so the lobby's join-error toast stacks
  // BELOW it (Lobby.jsx) instead of being drawn under it.
  useLayoutEffect(() => {
    const clear = () => { try { setTournamentBannerBottom(0); } catch { /* ignore */ } };
    if (!visible) { clear(); return undefined; }
    const publish = () => {
      try {
        const r = bannerRef.current ? bannerRef.current.getBoundingClientRect() : null;
        setTournamentBannerBottom(r && r.bottom > 0 ? r.bottom : 0);
      } catch { /* ignore */ }
    };
    publish();
    let ro = null;
    try {
      if (typeof ResizeObserver === 'function' && bannerRef.current) { ro = new ResizeObserver(publish); ro.observe(bannerRef.current); }
    } catch { ro = null; }
    try { window.addEventListener('resize', publish); } catch { /* ignore */ }
    return () => {
      try { window.removeEventListener('resize', publish); } catch { /* ignore */ }
      try { if (ro) ro.disconnect(); } catch { /* ignore */ }
    };
  }, [visible, awaySeats, notice, returning]);
  useLayoutEffect(() => () => { try { setTournamentBannerBottom(0); } catch { /* ignore */ } }, []);

  if (!visible) return null;

  const tapReturn = (key) => {
    returnToTournament(key).catch(() => { /* answered in the store */ });
  };

  return (
    <div
      ref={bannerRef}
      className="tournament-return-banner"
      role="status"
      aria-live="polite"
      style={{
        ...CARD_STYLE,
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 72px)',
        left: '50%', transform: 'translateX(-50%)',
        zIndex: 10040,
        width: 'min(92vw, 400px)',
        padding: '14px 16px',
      }}
    >
      {awaySeats.length ? (
        <>
          {awaySeats.map((a, i) => (
            <div key={a.key || i} style={i > 0 ? { marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,210,74,0.25)' } : undefined}>
              <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>
                You are still in {a.name || 'your tournament'}
              </div>
              <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: '#cfe0ff' }}>
                {`Your hand is folded for you while you are away (${TOURNAMENT_ABSENT_LIMP_NOTE}) and your blinds are posted from your stack.`}
                {Number.isFinite(a.chips) ? ` Stack: ${a.chips.toLocaleString()} chips.` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                {/* Round 6 — a Return that got NO answer at all (an older
                    server: nothing will ever answer) can be dismissed. */}
                {noticeKind === 'no_answer' && noticeKey === a.key && !returning && (
                  <button
                    type="button"
                    className="tournament-return-dismiss"
                    style={BLUE_BUTTON}
                    onClick={() => { if (mounted.current) dismissAwaySeat(a.key); }}
                  >
                    Dismiss
                  </button>
                )}
                <button
                  type="button"
                  style={{ ...GOLD_BUTTON, opacity: returning ? 0.7 : 1, cursor: returning ? 'default' : 'pointer' }}
                  disabled={!!returning}
                  onClick={() => { if (mounted.current) tapReturn(a.key); }}
                >
                  {returning === a.key ? 'Returning…' : 'Return to tournament'}
                </button>
              </div>
            </div>
          ))}
          {notice && (
            <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45, color: '#e8eefc' }}>{notice}</div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 13.5, lineHeight: 1.45, color: '#e8eefc' }}>{notice}</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
            <button type="button" style={BLUE_BUTTON} onClick={dismissTournamentNotice}>OK</button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Avatar-customizer banner: the server put this socket back in a seat in the
 * BACKGROUND (a reconnect's seat restore) while the player was customizing his
 * avatar. The screen is not switched under him; this offers the table.
 */
export function SeatRestoredBanner() {
  const restored = useTournamentSeatStore((s) => s.seatRestored);
  if (!restored) return null;
  const goToTable = () => {
    clearSeatRestored();
    try { useGameStore.getState().setScreen('table'); } catch { /* ignore */ }
  };
  return (
    <div
      className="seat-restored-banner"
      role="status"
      aria-live="polite"
      style={{
        ...CARD_STYLE,
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        left: '50%', transform: 'translateX(-50%)',
        zIndex: 10040,
        width: 'min(92vw, 400px)',
        padding: '14px 16px',
      }}
    >
      <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>
        You are back in your seat
      </div>
      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: '#cfe0ff' }}>
        Your connection came back and your seat at the table was restored. Hands are dealt to you while you are here.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" style={BLUE_BUTTON} onClick={clearSeatRestored}>Later</button>
        <button type="button" style={GOLD_BUTTON} onClick={goToTable}>Go to table</button>
      </div>
    </div>
  );
}
