import { useId, useMemo, useState } from 'react';
import './TournamentLists.css';
// 2026-11-25 (owner: "for all online tournaments to be able to see who is
// registered in the lobby and a list for it to show who busted in each
// position") - every rule lives in the pure module; this file only draws it.
import {
  registeredLabel, REGISTERED_EMPTY_TEXT, RESULTS_BUTTON_TEXT,
  standingsLists, finishListSections, finishRowText, chipsText,
} from '../../utils/tournamentLists';

/**
 * "Registered (N)" on a lobby card: a button (aria-expanded) that opens the
 * public names of everyone registered, in registration order, in a panel that
 * scrolls inside its own bounded box (phones included). `names` null (the
 * server did not send the field) = nothing at all (today's card). Taps never
 * reach the card under it (the qualifier card opens its detail window).
 */
export function RegisteredToggle({ names, className = '' }) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  if (!Array.isArray(names)) return null;
  const panelId = `${uid}-registered`;
  return (
    <div className={`tl-registered ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="tl-registered-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">👥</span> {registeredLabel(names)} <span className="tl-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        // tabIndex: the bounded panel can be scrolled from the keyboard.
        <div id={panelId} className="tl-registrants-panel" role="region" aria-label="Registered players" tabIndex={0}>
          {names.length === 0 ? (
            <div className="tl-list-empty">{REGISTERED_EMPTY_TEXT}</div>
          ) : (
            <ol className="tl-registrants-list" role="list">
              {/* Keyed by registration order: names can repeat ("John S." twice). */}
              {names.map((n, i) => (
                <li key={i} className="tl-registrant">
                  <span className="tl-reg-num" aria-hidden="true">{i + 1}.</span>
                  <span className="tl-reg-name">{n}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Results" on a lobby card: opens the finish-order list (the Live Bracket's
 * list view) of `tournamentId`. Nothing without an id or a handler.
 */
export function ResultsButton({ tournamentId, onOpen, className = '' }) {
  if (!tournamentId || typeof onOpen !== 'function') return null;
  return (
    <button
      type="button"
      className={`tl-results-btn ${className}`.trim()}
      aria-haspopup="dialog"
      onClick={(e) => { e.stopPropagation(); onOpen(tournamentId); }}
    >
      <span aria-hidden="true">🏁</span> {RESULTS_BUTTON_TEXT}
    </button>
  );
}

/**
 * The finish-order list of one standings answer: "Still in (N)" (chip counts)
 * above the busted players, each with the place the SERVER stored ("24th
 * Paula G."), the most recent bust first. Keys are the server's opaque
 * per-tournament tokens.
 */
export function FinishOrderList({ standings }) {
  const uid = useId();
  const view = useMemo(() => finishListSections(standingsLists(standings)), [standings]);
  if (view.unavailable) return <div className="tl-list-empty tl-finish-unavailable">{view.text}</div>;
  return (
    <div className="tl-finish">
      {view.sections.map((sec) => {
        const headingId = `${uid}-${sec.kind}`;
        return (
          <section key={sec.kind} className={`tl-finish-section tl-finish-section--${sec.kind}`} aria-labelledby={headingId}>
            <h3 id={headingId} className="tl-finish-heading">{sec.heading}</h3>
            {sec.note ? <div className="tl-finish-note">{sec.note}</div> : null}
            {sec.empty ? <div className="tl-list-empty">{sec.empty}</div> : null}
            {sec.rows.length > 0 && sec.kind === 'stillIn' && (
              <ol className="tl-still-in-list" role="list">
                {sec.rows.map((r) => (
                  <li key={r.key} className="tl-still-in-row">
                    <span className="tl-finish-name">{r.name}</span>
                    {r.chips !== null && <span className="tl-still-in-chips">{chipsText(r.chips)}</span>}
                  </li>
                ))}
              </ol>
            )}
            {sec.rows.length > 0 && sec.kind === 'busted' && (
              <ol className="tl-finish-list" role="list">
                {sec.rows.map((r) => (
                  <li key={r.key} className="tl-finish-row" aria-label={finishRowText(r)}>
                    <span className="tl-finish-place">{r.placeText}</span>
                    <span className="tl-finish-name">{r.name}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
