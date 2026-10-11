import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { phaseLabel } from '../../utils/tableList';
import './SeatPicker.css';

/**
 * Seat picker (R2 C1, 2026-10-11 — APPUI-39).
 *
 * Shows the REAL occupancy the server lists for this table (seats[] —
 * {index, occupied, name}); only an open seat can be picked, and the pick is
 * sent as the join's seatIndex, which poker-server honours while the seat is
 * still empty. `table` is the live list row (the lobby re-renders it on every
 * 5s list refresh, so a seat taken meanwhile turns occupied here). The lobby
 * never opens the picker for a table without seat positions (an older server):
 * there the server picks the seat.
 *
 * Responsive: the oval and the seats are laid out in percentages of a 4:3 box
 * that is as wide as the card (min(440px, viewport - margins)) — the old picker
 * was a fixed 440px canvas with 400px of absolute positions, clipped at 320-430px.
 *
 * Rendered into <body> like the lobby's other overlays (FriendSystem, ClubsPanel,
 * CreateTableModal): Lobby.css gives every direct child of .lobby
 * `position: relative; z-index: 1`, which would pin an in-tree picker to the
 * bottom of the lobby instead of over the viewport. (Inline when there is no
 * DOM, e.g. server rendering in tests.)
 */
const mount = (node) => (typeof document === 'undefined' ? node : createPortal(node, document.body));

export default function SeatPicker({ table, preferredSeat = null, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!table) {
    return mount(
      <div className="seat-picker-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Choose your seat">
        <div className="seat-picker-card" onClick={(e) => e.stopPropagation()}>
          <h3 className="seat-picker-title">Table closed</h3>
          <p className="seat-picker-sub">This table is no longer in the lobby. Pick another one.</p>
          <button type="button" className="seat-picker-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const maxSeats = table.maxSeats || 9;
  const seats = Array.isArray(table.seats) && table.seats.length
    ? table.seats
    : Array.from({ length: maxSeats }, (_, i) => ({ index: i, occupied: false, name: null }));
  const open = seats.filter((s) => !s.occupied).length;
  const phase = phaseLabel(table.phase);

  return mount(
    <div className="seat-picker-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Choose your seat">
      <div className="seat-picker-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="seat-picker-title">Choose your seat</h3>
        <p className="seat-picker-sub">
          <span className="seat-picker-name">{table.tableName}</span>
          <span> · Blinds {Number(table.smallBlind || 0).toLocaleString()}/{Number(table.bigBlind || 0).toLocaleString()}</span>
          {table.minBuyIn > 0 && <span> · Min buy-in {Number(table.minBuyIn).toLocaleString()}</span>}
        </p>
        <p className="seat-picker-open" aria-live="polite">
          {open > 0 ? `${open} of ${maxSeats} seats open` : 'Every seat is taken right now'}
          {phase && <span className="seat-picker-phase"> · {phase}</span>}
        </p>

        <div className="seat-picker-table">
          <div className="seat-picker-felt"><span>AMERICAN PUB POKER</span></div>
          {seats.map((s, i) => {
            const angle = (Math.PI / 2) - (i * (2 * Math.PI / seats.length));
            const left = 50 + Math.cos(angle) * 40;
            const top = 50 - Math.sin(angle) * 38;
            const preferred = preferredSeat === s.index && !s.occupied;
            return (
              <button
                key={s.index}
                type="button"
                className={`seat-picker-seat ${s.occupied ? 'seat-picker-seat--taken' : 'seat-picker-seat--open'} ${preferred ? 'seat-picker-seat--preferred' : ''}`}
                style={{ left: `${left}%`, top: `${top}%` }}
                disabled={s.occupied}
                onClick={() => { if (!s.occupied) onPick?.(s.index); }}
                aria-label={s.occupied ? `Seat ${s.index + 1}, taken${s.name ? ` by ${s.name}` : ''}` : `Seat ${s.index + 1}, open`}
                title={s.occupied ? (s.name || 'Taken') : (preferred ? 'Your usual seat' : 'Open seat')}
              >
                <span className="seat-picker-seat-num">Seat {s.index + 1}</span>
                <span className="seat-picker-seat-state">{s.occupied ? (s.name || 'Taken') : (preferred ? 'Your seat' : 'Open')}</span>
              </button>
            );
          })}
        </div>

        <div className="seat-picker-actions">
          <button type="button" className="seat-picker-any" onClick={() => onPick?.(-1)} disabled={open === 0}>
            Any open seat
          </button>
          <button type="button" className="seat-picker-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
