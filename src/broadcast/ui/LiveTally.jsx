/**
 * LiveTally — the feed pill (lead spec R9 + C1, 2026-11-02). Never red.
 *
 * - Feed health always shows when it is not ok: AMBER 'Reconnecting' after 6 s
 *   without a heartbeat, SLATE 'Signal lost' after 15 s (the scene goes to the
 *   slate as well). Viewers see why the picture is frozen.
 * - The ON AIR / REHEARSAL / OFF AIR tally only with ?tally=1 (a preview or
 *   monitor source). The stream worker loads tally=0, so it never burns a
 *   tally into the output.
 */
export default function LiveTally({ health = 'ok', showTally = false, onAir = false, rehearsal = false, keyRefused = null }) {
  const pills = [];
  if (health === 'amber') {
    pills.push(<div key="feed" className="bc-tally bc-tally--amber" role="status"><span className="bc-tally__dot" />Reconnecting</div>);
  } else if (health === 'stale') {
    pills.push(<div key="feed" className="bc-tally bc-tally--stale bc-stale" role="status"><span className="bc-tally__dot" />Signal lost</div>);
  }
  if (showTally) {
    const kind = rehearsal ? 'rehearsal' : (onAir ? 'on-air' : 'off-air');
    const text = rehearsal ? 'Rehearsal' : (onAir ? 'On air' : 'Off air');
    pills.push(
      <div key="tally" className={`bc-tally bc-tally--${kind}`} data-key-refused={keyRefused || undefined}>
        <span className="bc-tally__dot" />{text}{keyRefused ? ' · public feed' : ''}
      </div>,
    );
  }
  return pills.length ? <>{pills}</> : null;
}
