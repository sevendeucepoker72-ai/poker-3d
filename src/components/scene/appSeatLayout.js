// APP Precision (2026-11-24), package 2: where the seats sit on a phone held
// upright (the skin's portrait layout). Pure functions, no DOM: PokerTable2D
// feeds the measured scene + felt boxes, the seat map and the chip flyers
// read the same answer, so a bet flies from the seat it belongs to.
//
// The hero sits at the bottom (GameHUD draws him); the others fill named
// slots around the rail, by how many seats the table has:
//   To / Ti / C  the top row (outer corner, inner, centre), on the rail's top
//   U / L        the side columns under the corners (upper, lower)
//   H            the bottom centre (a spectator's seat 0)
// Each seat's bet hangs under its nameplate when the column has room for it
// (appPlacement.js moves it beside the seat when not); the board, the pot
// and the hero's row stay clear.
//
// APP Precision repair: the columns are stacked from what is really drawn
// (opts.meas, from appPlacement.measureAppSeats): each pod's extent around
// its avatar (title, ALL IN, cards, bet) and the hero's row (his cards,
// nameplate, Sitting Out button, a spectator's banner). Without a
// measurement the old estimates apply.

export const APP_PORTRAIT_MQ = '(max-width: 600px) and (orientation: portrait)';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// slot names for the m players after the hero, clockwise from his left
const SLOTS = {
  1: ['C'],
  2: ['To', 'To'],
  3: ['U', 'C', 'U'],
  4: ['L', 'To', 'To', 'L'],
  5: ['L', 'U', 'C', 'U', 'L'],
  6: ['L', 'U', 'Ti', 'Ti', 'U', 'L'],
  7: ['L', 'U', 'To', 'C', 'To', 'U', 'L'],
  8: ['L', 'U', 'To', 'Ti', 'Ti', 'To', 'U', 'L'],
};

// The hero's corner (his cards, avatar and nameplate) at the bottom centre:
// the estimate used until the real hero row is measured. Package 3 keeps the
// hero inside it.
export function appHeroZone(W, H, pw) {
  const w = Math.min(clamp(W * 0.59, 150, 256), W - 2 * (pw + 4));
  const h = clamp(H * 0.27, 104, 132);
  return { w, h, left: W / 2 - w / 2, top: H - h };
}

// Everything the slots need, in scene px (the scene box is the space between
// the top bar and the action bar). `felt` is the felt box in scene px.
// opts.spectator: no hero corner (the side columns run to the bottom).
// opts.m: the players after the hero (seat cap - 1).
// opts.meas: { W, H, ext: { 'U-l': { up, down, l, r, betH } ... }, hero: [rects] }
export function appSeatGeometry(W, H, felt, opts = {}) {
  const spectator = !!opts.spectator;
  const m = clamp(Math.round(opts.m || 8), 1, 8);
  const list = SLOTS[m];
  const meas = opts.meas && Math.abs(opts.meas.W - W) < 1.5 && Math.abs(opts.meas.H - H) < 1.5 ? opts.meas : null;
  const av = Math.round(clamp(W * 0.108, 34, 48));
  const pw = W < 360 ? 70 : W < 400 ? 76 : 80;
  // a short screen drops the plate's last-action line while a bet shows or
  // the seat has folded (AppPrecisionSeats.css), so its pods are shorter
  const short = H < 400;
  const plateH = short ? 38 : 51;               // name, stack, last action
  const betH = 24;                              // the bet pill + its gap
  const a = 4 + av / 2;                         // pod top -> avatar centre
  const podDown = av / 2 - 6 + plateH + 4;      // avatar centre -> pod bottom
  const { x: fx, y: fy, w: fw, h: fh } = felt;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const rs = clamp(Math.min(fw * 0.23, (W - fw) / 2 - 6), 18, 64);
  // a plate grows to pmax for a long stack (narrowed below for a full top row)
  let pmax = pw + 8;
  // the side columns: on the rail, but never over the board's ends
  const cardW = clamp((fw * 0.86 - 12) / 5, 24, 47);
  const boardL = cx - (cardW * 5 + 12) / 2;
  const hz = appHeroZone(W, H, pmax);
  // ... nor into the hero's corner (so the lower seats can sit beside it)
  // (repair 2: nor the seat's cards, tucked beside the avatar on its inner
  // side, which reach about one avatar from its centre)
  const xs = Math.max(pmax / 2 + 2, Math.min(fx - rs * 0.5, boardL - pmax / 2 - 4, boardL - av * 1.05 - 3, spectator ? W : hz.left - pmax / 2 - 2));
  // the top row: the inner seats between the corners; where four do not fit
  // with a gap (a 9-seat table on a narrow phone) they are spaced evenly and
  // the plates narrowed to the spacing
  let dTi = clamp((cx - xs) * 0.45, pmax / 2 + 4, Math.max(pmax / 2 + 4, cx - xs - pmax - 4));
  if (list.includes('To') && list.includes('Ti') && cx - xs - dTi < pmax + 3) {
    dTi = (cx - xs) / 3;
    pmax = Math.min(pmax, Math.floor(2 * dTi - 3));
  }

  // measured extents around the avatar centre (no bet); null = estimate.
  // "with bet" keeps a bet's room under every plate whether or not one is out
  // (seats do not shift when someone bets); a WINNER tag may need more
  const ext = (k) => (meas && meas.ext ? meas.ext[k] : null) || null;
  // (withBet 'actual': only the bets / tags out now, when every plate's room
  // does not fit)
  const downOf = (k, withBet) => {
    const e = ext(k);
    if (!e) return podDown + (withBet ? betH : 0);
    if (withBet === 'actual') return e.down + (e.betH ? e.betH + 2 : 0);
    return e.down + (withBet ? Math.max(e.betH, betH - 2) + 2 : 0);
  };

  // the top row sits above the rail so its bets end just inside the felt's
  // top edge, above the pot plate (and its chip pile on wider phones); never
  // under the top bar
  const boardCy = fy + fh * 0.49;
  const potTop = boardCy - (cardW * 1.24) / 2 - 4 - 28 - (W <= 360 ? 0 : clamp(fw * 0.115, 22, 34) - 7);
  const topKeys = [];
  if (list.includes('Ti')) topKeys.push('Ti-l', 'Ti-r');
  if (list.includes('C')) topKeys.push('C-c');
  const tDown = topKeys.length ? Math.max(...topKeys.map((k) => downOf(k, true))) : podDown + betH;
  const topMin = a + 2;
  let yTop = Math.max(topMin, Math.min(fy + 12 - tDown, potTop - tDown - 2));

  // the side columns, top to bottom (To, U, L as the seat count has them),
  // each side on its own: a row never above the top bar, never into the
  // hero's row, never on the row above (with its bet under the plate when
  // that fits, else without: the bet then goes beside the seat)
  const cornerDrop = av * 0.4;
  const rows = ['To', 'U', 'L'].filter((r) => list.includes(r));
  const lClearEst = spectator || xs + pmax / 2 + 2 <= hz.left + 0.5;
  const col = { l: {}, r: {} };
  const gap = 3;
  for (const side of ['l', 'r']) {
    const x = side === 'l' ? xs : W - xs;
    const items = rows.map((r) => {
      const k = `${r}-${side}`;
      const e = ext(k);
      const el = e ? e.l : pmax / 2 + 2;
      const er = e ? e.r : pmax / 2 + 2;
      let bottom = H;
      if (meas && meas.hero) {
        for (const o of meas.hero) {
          if (o.x < x + er && o.x + o.w > x - el && o.y > H * 0.3) bottom = Math.min(bottom, o.y);
        }
      } else if (!lClearEst) {
        bottom = hz.top;
      }
      const pref = r === 'To' ? yTop + cornerDrop : r === 'U' ? cy - fh * 0.18 : cy + fh * 0.2;
      return { k, up: e ? e.up : a, bottom: bottom - 4, pref };
    });
    const n = items.length;
    const solve = (withBet) => {
      const dn = items.map((it) => downOf(it.k, withBet));
      const up = items.map((it) => it.up);
      const ys = items.map((it) => it.pref);
      for (let i = 0; i < n; i += 1) {
        ys[i] = Math.max(ys[i], i ? ys[i - 1] + dn[i - 1] + gap + up[i] : Math.max(topMin, up[0] + 2));
      }
      for (let i = n - 1; i >= 0; i -= 1) {
        ys[i] = Math.min(ys[i], items[i].bottom - dn[i], i < n - 1 ? ys[i + 1] - up[i + 1] - gap - dn[i] : Infinity);
      }
      let ok = n === 0 || ys[0] - up[0] >= 1.5;
      for (let i = 1; i < n && ok; i += 1) ok = ys[i] - up[i] >= ys[i - 1] + dn[i - 1] + gap - 0.5;
      return { ys, dn, up, ok };
    };
    let res = solve(true);
    if (!res.ok && meas) res = solve('actual');
    if (!res.ok) res = solve(false);
    if (!res.ok && n) {
      // still too tall: from the top bar down to the lowest bound, the rows
      // share the shortfall evenly (no row under the top bar or the hero)
      const { dn, up } = res;
      const lo = Math.max(topMin, up[0] + 2);
      const hi = Math.max(lo, items[n - 1].bottom - dn[n - 1]);
      let sum = 0;
      for (let i = 1; i < n; i += 1) sum += dn[i - 1] + gap + up[i];
      const k = sum > 0 ? Math.min(1, (hi - lo) / sum) : 1;
      res.ys[0] = lo;
      for (let i = 1; i < n; i += 1) res.ys[i] = res.ys[i - 1] + (dn[i - 1] + gap + up[i]) * k;
    }
    rows.forEach((r, i) => { col[side][r] = res.ys[i]; });
  }
  // a corner seat pushed above the inner ones lifts the inner row with it
  if (col.l.To != null && col.r.To != null) yTop = Math.max(topMin, Math.min(yTop, col.l.To, col.r.To));

  // a spectator's seat 0: on the felt's bottom edge (its bet beside it), above
  // the empty hand slots GameHUD keeps at the bottom centre (and the
  // "Spectating / Leave" banner under them)
  const yH = Math.min(fy + fh - av * 0.2, H - podDown - 90);
  // the pot pile's centre (above the board), where the chip flyers land
  const potY = boardCy - (cardW * 1.24) / 2 - 30;
  // the hero's nameplate may use the width between the lower side seats
  const heroMax = list.includes('L') && !spectator ? Math.floor(W - 2 * (xs + pmax / 2 + 4)) : null;
  return { W, H, av, pw, pmax, short, cx, cy, xs, yTop, col, yH, dTi, hz, potY, heroMax };
}

// One seat's spot: the avatar centre (as % of the scene, for left / top), its
// slot and side, and where its bet, cards and dealer button go. `rel` = seats
// clockwise from the hero (0 = hero); heroSeated false = a spectator (seat 0 at
// the bottom, no hero corner).
//   betX     px, the bet pill's shift toward the table (it hangs under the plate)
//   cardsX   which side of the avatar the cards tuck in (-1 left, 1 right)
//   dX, dY   the dealer button's side and height (in avatars) beside the avatar
export function appSeatSpot(g, rel, cap, heroSeated) {
  const m = Math.max(1, Math.min(8, cap - 1));
  const list = SLOTS[m];
  let slot;
  let side;
  if (rel === 0) {
    slot = heroSeated ? 'hero' : 'H';
    side = 'c';
  } else {
    const k = rel - 1;
    slot = list[Math.min(k, list.length - 1)];
    side = slot === 'C' ? 'c' : (k < m / 2 ? 'l' : 'r');
  }
  const sgn = side === 'l' ? -1 : side === 'r' ? 1 : 0;
  const { W, H, av, cx, xs } = g;
  const colY = (r) => {
    const v = g.col && g.col[side] ? g.col[side][r] : null;
    return v != null ? v : g.yTop;
  };
  let x;
  let y;
  switch (slot) {
    case 'To': x = sgn < 0 ? xs : W - xs; y = colY('To'); break;
    case 'Ti': x = cx + sgn * g.dTi; y = g.yTop; break;
    case 'C': x = cx; y = g.yTop; break;
    case 'U': x = sgn < 0 ? xs : W - xs; y = colY('U'); break;
    case 'L': x = sgn < 0 ? xs : W - xs; y = colY('L'); break;
    case 'hero': x = cx; y = g.hz.top; break;
    default: x = cx; y = g.yH; break;   // H
  }
  const inward = -sgn;   // toward the table's middle
  // a lower seat's bet stays under its own plate (inward it would reach the
  // hero's row)
  let betX = slot === 'L' ? 0 : inward * Math.min(12, av * 0.25);
  let cardsX = sgn === 0 ? -1 : inward;
  let dX = sgn === 0 ? 1 : sgn;     // the dealer button on the outer side
  let dY = -0.06;
  if (slot === 'hero') {
    // the top centre of the hero's corner: his bet, dealer button and WINNER
    // tag are placed beside his cards by appPlacement.js
    betX = -(g.hz.w / 2 - 32);
    cardsX = -1;
    dX = 0;
    dY = 0;
  }
  return {
    slot,
    side,
    left: (x / W) * 100,
    top: (y / H) * 100,
    betX,
    cardsX,
    dX,
    dY,
  };
}
