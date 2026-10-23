// 2026-10-22 (owner: "run the blinds and raise them, take breaks ... start the
// game on time") — the tournament table's running level clock, its standings
// line and the held-table banner ("Cards are dealt at 11:00 AM MT · 9:12",
// "Break — play resumes at 1:05 PM MT · 4:31", "Paused by the tournament
// director"). Reads ONLY the optional gameState.tournamentClock
// (utils/tournamentClock.js): without it (a cash table, an older server)
// these render nothing and GameHUD keeps its old widgets.
// Small components of their own so the per-second tick re-renders them, not
// the whole HUD. Blue + gold only (owner rule: no red).
// Review fix-up: GameHUD passes the NORMALIZED clock (`clock`, after
// resumedClock: a resume event newer than the frame ends the held state); the
// line is two spans so a clipped line (landscape phones) cuts the blinds, never
// the "in m:ss" countdown.
import { useEffect, useState } from 'react';
import { useTimerStore } from '../../store/timerStore';
import {
  clockSkewMs,
  levelRemainingMs,
  levelBarFraction,
  levelBarColor,
  clockStripParts,
  standingsParts,
  heldBannerFor,
  msUntil,
  formatClock,
} from '../../utils/tournamentClock';

const TICK_MS = 500;
// A flex item drops leading collapsible spaces: the joiner's spaces are no-break.
const NBSP = ' ';

function useLocalNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The level clock + standings line (hud-center-info). Nothing without blinds. */
export function TournamentClockStrip({ clock }) {
  const fallbackSkew = useTimerStore((s) => s.clockSkewMs);
  const now = useLocalNow();
  if (!clock || !clock.bb) return null;
  const skew = clockSkewMs(clock, fallbackSkew);
  const remaining = levelRemainingMs(clock, now, skew);
  const frac = levelBarFraction(clock, remaining);
  const color = levelBarColor(remaining, clock.durationMs);
  const line = clockStripParts(clock, remaining);
  if (!line) return null;
  const text = `${line.main}${line.joiner}${line.tail}`;
  const st = standingsParts(clock);
  return (
    <div
      className={`tournament-clock-strip${clock.paused ? ' tournament-clock-strip--paused' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={`Tournament clock: ${text}`}
    >
      <div className="tournament-clock-line">
        <span className="tcl-main">{line.main}</span>
        {line.tail && <span className="tcl-tail">{line.joiner.replace(/ /g, NBSP)}{line.tail}</span>}
      </div>
      {frac != null && (
        <div className="tournament-clock-bar" aria-hidden="true">
          <div className="tournament-clock-bar-fill" style={{ width: `${(frac * 100).toFixed(1)}%`, background: color }} />
        </div>
      )}
      {st && (
        <div className="tournament-standings-line">
          {st.left && <span className="tsl-part tsl-left">{st.left}</span>}
          {st.avg && <span className="tsl-part tsl-avg">{st.avg}</span>}
          {st.paid && <span className="tsl-part tsl-paid">{st.paid}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The waiting area of a HELD tournament table (prestart / break / director
 * pause / a hold of another reason), with its m:ss countdown when the server
 * sent the instant.
 */
export function TournamentHeldBanner({ clock }) {
  const fallbackSkew = useTimerStore((s) => s.clockSkewMs);
  const now = useLocalNow();
  const banner = heldBannerFor(clock);
  if (!banner) return null;
  const left = banner.countdownTo ? msUntil(banner.countdownTo, now, clockSkewMs(clock, fallbackSkew)) : null;
  const kindClass = banner.kind === 'prestart'
    ? 'qualifier-deals-at'
    : banner.kind === 'break' ? 'tournament-break-banner'
      : banner.kind === 'held' ? 'tournament-hold-banner' : 'tournament-director-pause';
  return (
    <span className={`tournament-held-banner ${kindClass}`}>
      <span className="tournament-held-text" role="status">{banner.text}</span>
      {/* A flex item drops a leading space: the separator's spaces are no-break. */}
      {left != null && <span className="tournament-held-countdown" role="timer">{`${NBSP}·${NBSP}`}{formatClock(left)}</span>}
    </span>
  );
}
