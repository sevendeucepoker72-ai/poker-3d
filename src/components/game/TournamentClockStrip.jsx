// 2026-10-22 (owner: "run the blinds and raise them, take breaks ... start the
// game on time") — the tournament table's running level clock, its standings
// line and the held-table banner ("Cards are dealt at 11:00 AM MT · 9:12",
// "Break — play resumes at 1:05 PM MT · 4:31", "Paused by the tournament
// director"). Reads ONLY the optional gameState.tournamentClock
// (utils/tournamentClock.js): without it (a cash table, an older server)
// these render nothing and GameHUD keeps its old widgets.
// Small components of their own so the per-second tick re-renders them, not
// the whole HUD. Blue + gold only (owner rule: no red).
import { useEffect, useMemo, useState } from 'react';
import { useTimerStore } from '../../store/timerStore';
import {
  normalizeTournamentClock,
  clockSkewMs,
  levelRemainingMs,
  levelBarFraction,
  levelBarColor,
  clockStripText,
  standingsParts,
  heldBannerFor,
  msUntil,
  formatClock,
} from '../../utils/tournamentClock';

const TICK_MS = 500;

function useLocalNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The level clock + standings line (hud-center-info). Nothing without blinds. */
export function TournamentClockStrip({ rawClock }) {
  const clock = useMemo(() => normalizeTournamentClock(rawClock), [rawClock]);
  const fallbackSkew = useTimerStore((s) => s.clockSkewMs);
  const now = useLocalNow();
  if (!clock || !clock.bb) return null;
  const skew = clockSkewMs(clock, fallbackSkew);
  const remaining = levelRemainingMs(clock, now, skew);
  const frac = levelBarFraction(clock, remaining);
  const color = levelBarColor(remaining, clock.durationMs);
  const text = clockStripText(clock, remaining);
  const st = standingsParts(clock);
  return (
    <div
      className={`tournament-clock-strip${clock.paused ? ' tournament-clock-strip--paused' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={text}
    >
      <div className="tournament-clock-line">{text}</div>
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
 * pause), with its m:ss countdown when the server sent the instant.
 */
export function TournamentHeldBanner({ rawClock }) {
  const clock = useMemo(() => normalizeTournamentClock(rawClock), [rawClock]);
  const fallbackSkew = useTimerStore((s) => s.clockSkewMs);
  const now = useLocalNow();
  const banner = heldBannerFor(clock);
  if (!banner) return null;
  const left = banner.countdownTo ? msUntil(banner.countdownTo, now, clockSkewMs(clock, fallbackSkew)) : null;
  const kindClass = banner.kind === 'prestart'
    ? 'qualifier-deals-at'
    : banner.kind === 'break' ? 'tournament-break-banner' : 'tournament-director-pause';
  return (
    <span className={`tournament-held-banner ${kindClass}`}>
      <span className="tournament-held-text" role="status">{banner.text}</span>
      {/* A flex item drops a leading space: the separator's spaces are no-break. */}
      {left != null && <span className="tournament-held-countdown" role="timer">{' · '}{formatClock(left)}</span>}
    </span>
  );
}
