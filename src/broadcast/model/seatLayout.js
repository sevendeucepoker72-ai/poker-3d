/**
 * Broadcast table seat positions (lead spec C2 / C5, 2026-11-02). Fixed
 * places, so a seat never moves on air: seat 0 at the bottom, then clockwise —
 * the same ring order as the player table (PokerTable2D SEAT_ANGLES).
 * Positions are percentages of the seat-ring box.
 *
 * - 16:9: evenly spaced round a wide oval.
 * - 9:16: a narrow tall felt with the seats in a LEFT and a RIGHT column
 *   outside it (bottom → up the left → top → down the right), so the board in
 *   the middle is never covered on a phone-shaped picture. An odd remainder
 *   puts one seat at the top centre.
 *
 * A seat's bet is drawn as a tab under its own nameplate (SeatPlate), never
 * loose on the felt: with nine seats, side pots and an action line the felt
 * has no free place a chip pile could always use (box-overlap pass over the
 * fixtures at 1920x1080 and 1080x1920 in the browser, 2026-11-02).
 */
export const MIN_SEATS = 2;
export const MAX_SEATS = 10;

// 16:9 ring: centre and radii, % of the box.
const RING_16X9 = Object.freeze({ cx: 50, cy: 47, rx: 45, ry: 42 });
// 9:16 columns, % of the box.
const COLS_9X16 = Object.freeze({ left: 10.5, right: 89.5, top: 16, bottom: 80, topSeatY: 5, bottomSeatY: 90 });

/** Clamp a seat count to what the felt draws. */
export function seatCountOf(maxSeats) {
  const n = Number.isInteger(maxSeats) ? maxSeats : 9;
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, n));
}

const round = (v) => Math.round(v * 100) / 100;
const seat = (seatIndex, x, y, side) => ({ seatIndex, x: round(x), y: round(y), side });

function ring16x9(n) {
  const r = RING_16X9;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = r.cx + r.rx * Math.cos(a);
    const y = r.cy + r.ry * Math.sin(a);
    const dx = (x - r.cx) / r.rx;
    const dy = (y - r.cy) / r.ry;
    const side = Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? 'bottom' : 'top') : (dx >= 0 ? 'right' : 'left');
    out.push(seat(i, x, y, side));
  }
  return out;
}

function columns9x16(n) {
  const c = COLS_9X16;
  const rest = n - 1;                        // seat 0 is the bottom centre
  const perSide = Math.floor(rest / 2);
  const topSeat = rest % 2 === 1;
  const ys = (k) => (k === 1 ? [(c.top + c.bottom) / 2]
    : Array.from({ length: k }, (_, i) => c.bottom - (i * (c.bottom - c.top)) / (k - 1)));
  const out = [seat(0, 50, c.bottomSeatY, 'bottom')];
  let idx = 1;
  for (const y of ys(perSide)) out.push(seat(idx++, c.left, y, 'left'));               // up the left
  if (topSeat) out.push(seat(idx++, 50, c.topSeatY, 'top'));
  for (const y of ys(perSide).reverse()) out.push(seat(idx++, c.right, y, 'right'));   // down the right
  return out;
}

/**
 * [{seatIndex, x, y, side}] for every seat index 0..n-1: the nameplate centre
 * in % of the seat-ring box, and which side of the felt it is on.
 */
export function seatPositions(maxSeats, layout = '16x9') {
  const n = seatCountOf(maxSeats);
  return layout === '9x16' ? columns9x16(n) : ring16x9(n);
}
