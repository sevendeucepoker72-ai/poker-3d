// APP Precision (2026-11-24), package 2 repair: the skin's portrait layout
// (a phone held upright, build switch on) measures what it really draws.
// DOM reads and CSS custom properties only; nothing here changes game state.
//  1. measureAppSeats(scene): each seat pod's extent around its avatar centre
//     (plate rows, cards, bet) and the hero's row (his cards, nameplate, the
//     Sitting Out button, a spectator's banner), for appSeatLayout's columns.
//  2. placeAppFloaters(): the loose labels (seat bets, WINNER tags, the
//     hero's bet and dealer button, the outs counter, the Split Pot banner)
//     each take the first of a few candidate spots that covers nothing else
//     (else the one that covers least). A placed element carries
//     data-app-fl and --app-fx / --app-fy (AppPrecisionSeats.css).
// PokerTable2D runs both after each render of the table; GameHUD pings it
// after each render of the HUD (the hero's row and the outs live there).
// Repair 2: a crowded small phone searches rings around each seat (the
// hardest label first), a WINNER tag may narrow or turn compact, and a run
// with nothing changed stops early (placeSig).

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
// drawn at all (a bet fading in still counts: its place is what matters)
const shown = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  return getComputedStyle(el).visibility !== 'hidden';
};
const rnd = (v) => Math.round(v);

// ── 1. measuring ─────────────────────────────────────────────────────────
const POD_PARTS = ':scope > .seat-pod__avatar-wrap, :scope > .seat-pod__nameplate, :scope > .seat-pod__label, '
  + ':scope > .seat-pod__sit-btn, :scope > .seat-pod__cards, :scope > .seat-pod__owed-badge';
const HERO_ROW = '.hud.cinematic-hud .hud-cards.hud-cards-floating, .hud.cinematic-hud .hud-nameplate-me, '
  + '.hud.cinematic-hud .sit-out-quick-btn--active, .hud.cinematic-hud .app-spectator-banner';
const NOTICES = '.afk-warning-banner, .afk-away-banner, .bomb-pot-banner, .missed-blinds-panel, .mucked-hands-container';

export function measureAppSeats(scene) {
  if (!scene) return null;
  const sr = scene.getBoundingClientRect();
  if (!sr.width || !sr.height) return null;
  const ext = {};
  for (const pod of scene.querySelectorAll('.seat-pod.seat-pod--app')) {
    const mm = pod.className.match(/seat-pod--app-(To|Ti|C|U|L) seat-pod--app-([lrc])\b/);
    if (!mm) continue;
    const wrap = pod.querySelector(':scope > .seat-pod__avatar-wrap');
    if (!wrap) continue;
    const ar = wrap.getBoundingClientRect();
    const cx = ar.left + ar.width / 2;
    const cy = ar.top + ar.height / 2;
    let up = cy - ar.top;
    let down = ar.bottom - cy;
    let l = cx - ar.left;
    let r = ar.right - cx;
    for (const el of [pod, ...pod.querySelectorAll(POD_PARTS)]) {
      if (!shown(el)) continue;
      const b = el.getBoundingClientRect();
      up = Math.max(up, cy - b.top);
      down = Math.max(down, b.bottom - cy);
      l = Math.max(l, cx - b.left);
      r = Math.max(r, b.right - cx);
    }
    // what hangs under the plate when there is room: the bet, or at the
    // showdown the WINNER tag (the bets are in the pot by then)
    const bet = pod.querySelector(':scope > .chip-stack');
    const win = pod.querySelector(':scope > .seat-pod__winner-label');
    const betH = Math.max(shown(bet) ? bet.getBoundingClientRect().height : 0, shown(win) ? win.getBoundingClientRect().height : 0);
    ext[`${mm[1]}-${mm[2]}`] = { up: rnd(up), down: rnd(down), l: rnd(l), r: rnd(r), betH: rnd(betH) };
  }
  const hero = [];
  for (const el of document.querySelectorAll(HERO_ROW)) {
    if (!shown(el)) continue;
    const b = el.getBoundingClientRect();
    hero.push({ x: rnd(b.left - sr.left), y: rnd(b.top - sr.top), w: rnd(b.width), h: rnd(b.height) });
  }
  hero.sort((p, q) => p.x - q.x || p.y - q.y);
  return { W: rnd(sr.width), H: rnd(sr.height), ext, hero };
}

export const sameAppMeas = (p, q) => JSON.stringify(p) === JSON.stringify(q);

// ── 2. placing ───────────────────────────────────────────────────────────
function overlapArea(p, q, m) {
  const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) + m;
  const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) + m;
  return w > 0 && h > 0 ? w * h : 0;
}
// (an obstacle with `own` = a seat pod's box: that seat's own labels may sit in it)
// (stop: past this the candidate cannot win, so the sum stops early)
function score(r, obs, B, own, stop = Infinity) {
  let s = (Math.max(0, B.x - r.x) + Math.max(0, r.x + r.w - (B.x + B.w)) + Math.max(0, B.y - r.y) + Math.max(0, r.y + r.h - (B.y + B.h))) * 400;
  for (const o of obs) {
    if (s > stop) return s;
    if (!own || o.own !== own) s += overlapArea(r, o, 0.5) * (o.wt || 1);
  }
  return s;
}
// the first candidate that covers nothing (1px apart) inside the bounds, else
// the least bad one; candidates are top-left points
// (a candidate's `pen`: a far spot only wins the least-bad contest by more;
// k = the score plus that, for a free spot just its pen)
function pick(w, h, cands, obs, B, own) {
  let best = null;
  for (const c of cands) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const r = { x: c.x, y: c.y, w, h };
    const s = score(r, obs, B, own, best ? best.k : Infinity);
    if (s === 0) return { r, s, k: c.pen || 0 };
    const k = s + (c.pen || 0);
    if (!best || k < best.k) best = { r, s, k };
  }
  return best;
}
// keep a candidate's x inside the bounds (a label never leaves the screen)
const clampX = (x, w, B) => Math.min(Math.max(x, B.x), B.x + B.w - w);
// (repair 2) the wider search when the first spots are taken (a crowded
// small phone): rings around the point c (a label's centre on each), nearest
// first, and on each ring the side toward t (the pot) first. Top-left points.
function rings(c, t, w, h, r0, r1) {
  const list = [];
  const a0 = Math.atan2(t.y - c.y, t.x - c.x);
  for (let r = r0; r <= r1; r += 6) {
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 10));
    const ring = [];
    for (let i = 0; i < n; i += 1) {
      const a = a0 + (2 * Math.PI * i) / n;
      const off = Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0)));
      ring.push({ x: c.x + Math.cos(a) * r - w / 2, y: c.y + Math.sin(a) * r - h / 2, off });
    }
    ring.sort((p, q) => p.off - q.off);
    for (const p of ring) p.pen = r * 3;
    list.push(...ring);
  }
  return list;
}

function setVar(el, k, v) {
  const s = `${Math.round(v * 2) / 2}px`;
  if (el.style.getPropertyValue(k) !== s) el.style.setProperty(k, s);
}
function release(el) {
  el.removeAttribute('data-app-fl');
  el.removeAttribute('data-app-fw');
  el.removeAttribute('data-app-compact');
  el.style.removeProperty('--app-fx');
  el.style.removeProperty('--app-fy');
  el.style.removeProperty('--app-fw');
}
// (repair 2) a WINNER tag's size at its own width and a few others (its
// lines wrap, the hand's name ellipsizes), then compact (WINNER and the
// amount only; the hand stays in the tag for screen readers and is named
// by the hand-strength pill and the shown cards): a crowded small phone may
// have room only for a smaller tag. fw null = its own width.
const TAG_WIDTHS = [132, 112, 100];
const TAG_COMPACT = [null, 64];
function tagSizes(el) {
  el.removeAttribute('data-app-fw');
  el.removeAttribute('data-app-compact');
  el.style.removeProperty('--app-fw');
  const r0 = rectOf(el);
  const out = [{ fw: null, compact: false, w: r0.w, h: r0.h }];
  const at = (fw, compact) => {
    if (fw != null) {
      el.style.setProperty('--app-fw', `${fw}px`);
      el.setAttribute('data-app-fw', '');
    } else {
      el.removeAttribute('data-app-fw');
      el.style.removeProperty('--app-fw');
    }
    if (compact) el.setAttribute('data-app-compact', ''); else el.removeAttribute('data-app-compact');
    const r = rectOf(el);
    out.push({ fw, compact, w: r.w, h: r.h });
  };
  for (const fw of TAG_WIDTHS) if (Math.abs(fw - r0.w) >= 2) at(fw, false);
  for (const fw of TAG_COMPACT) at(fw, true);
  el.removeAttribute('data-app-fw');
  el.removeAttribute('data-app-compact');
  el.style.removeProperty('--app-fw');
  return out;
}

// (repair 2) the table and the HUD re-render often (a turn clock ticks every
// second): when nothing the placing reads has changed since the last run,
// the labels are already where they belong and the run stops early. A
// label's place does not move what this reads (only the sizes of the HUD
// labels it moves are read, and their text). A late web font changes sizes
// without changing this: PokerTable2D then calls invalidateAppPlacement().
let lastSig = '';
export function invalidateAppPlacement() { lastSig = ''; }
const sigBox = (el) => {
  if (!shown(el)) return '-';
  const r = el.getBoundingClientRect();
  return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
};
const sigSize = (el) => {
  if (!shown(el)) return '-';
  const r = el.getBoundingClientRect();
  return `${Math.round(r.width)}x${Math.round(r.height)}`;
};
function placeSig(scene, hud) {
  const parts = [window.innerWidth, window.innerHeight, sigBox(scene)];
  for (const el of scene.querySelectorAll('.table2d-felt, .table2d-pot-area, .table2d-pot-area > *')) parts.push(sigBox(el));
  for (const pod of scene.querySelectorAll('.seat-pod.seat-pod--app')) {
    parts.push(pod.className, sigBox(pod));
    for (const el of pod.querySelectorAll(`${POD_PARTS}, :scope > .dealer-btn`)) parts.push(sigBox(el));
    for (const el of pod.querySelectorAll(':scope > .chip-stack, :scope > .seat-pod__winner-label')) parts.push(el.textContent, sigSize(el));
  }
  if (hud) {
    for (const sel of ['.hud-top', '.hud-bottom', '.hud-cards.hud-cards-floating', '.hud-nameplate-me', '.hud-community', '.sit-out-quick-btn--active', '.app-spectator-banner']) {
      parts.push(sel);
      for (const el of hud.querySelectorAll(sel)) parts.push(sigBox(el));
    }
    for (const el of hud.querySelectorAll(`.hand-strength-portal, .hud-community .board-texture-badge, .chop-pot-banner, .hand-strength-container, ${NOTICES}`)) {
      parts.push(el.className, el.textContent, shown(el) ? '+' : '-');
    }
    for (const el of hud.querySelectorAll('.hand-strength-portal, .hud-community .board-texture-badge')) parts.push(sigSize(el));
  }
  return parts.join('|');
}

export function placeAppFloaters() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const scene = document.querySelector('.table2d-scene.app-seat-layout');
  const prev = Array.from(document.querySelectorAll('[data-app-fl]'));
  if (!scene) {
    lastSig = '';
    prev.forEach(release);
    root.classList.remove('app-fl');
    return;
  }
  root.classList.add('app-fl');
  const hud = document.querySelector('.hud.cinematic-hud');
  const felt = scene.querySelector('.table2d-felt');
  const sig = placeSig(scene, hud);
  if (sig === lastSig) return;
  lastSig = sig;

  // ── widths first (they decide the labels' heights) ──
  const W = window.innerWidth || root.clientWidth;
  const VH = window.innerHeight || root.clientHeight;
  const F = felt ? rectOf(felt) : { x: W / 4, y: VH / 3, w: W / 2, h: VH / 4 };
  // the room between the side columns (their plates' inner edges)
  let colL = 0;
  let colR = W;
  for (const el of scene.querySelectorAll('.seat-pod--app-U, .seat-pod--app-L')) {
    const side = el.classList.contains('seat-pod--app-l') ? 'l' : 'r';
    for (const part of [el, el.querySelector(':scope > .seat-pod__nameplate')]) {
      if (!shown(part)) continue;
      const r = part.getBoundingClientRect();
      if (side === 'l') colL = Math.max(colL, r.right); else colR = Math.min(colR, r.left);
    }
  }
  const chop = hud ? hud.querySelector('.chop-pot-banner:not(.app-chop-in-panel)') : null;
  if (chop) setVar(chop, '--app-fw', Math.max(120, F.w - 12));
  const outs = hud ? hud.querySelector('.hand-strength-container') : null;
  const hasOuts = !!(outs && outs.querySelector('.outs-display'));
  const heroCards = hud ? hud.querySelector('.hud-cards.hud-cards-floating') : null;
  const plate = hud ? hud.querySelector('.hud-nameplate-me') : null;
  const C = shown(heroCards) ? rectOf(heroCards) : (shown(plate) ? { ...rectOf(plate), h: 0 } : null);
  const sideW = C ? Math.min(C.x - 8, W - 2 - (C.x + C.w + 6)) : 0;
  const outsWide = Math.max(140, F.w - 24);
  const outsSide = Math.min(150, sideW);
  const outsCorner = Math.min(170, W * 0.5);
  const outsSize = {};
  if (hasOuts && shown(outs)) {
    // the outs box is as wide as its spot: its height per width
    for (const w of [outsWide, outsSide, outsCorner]) {
      if (w < 72 || outsSize[w]) continue;
      setVar(outs, '--app-fw', w);
      if (!outs.hasAttribute('data-app-fl')) outs.setAttribute('data-app-fl', '');
      outsSize[w] = rectOf(outs);
    }
  }
  // the notices the old top row pinned under the top bar (away, I'm back,
  // bomb pot, missed blinds, mucked hands): the top row of seats sits there
  // now. Their size at the screen's width and at the felt's width.
  const noteWide = W - 16;
  const noteFelt = Math.max(170, Math.min(F.w - 8, colR - colL - 8));
  const notes = [];
  if (hud) {
    for (const el of hud.querySelectorAll(NOTICES)) {
      if (!shown(el)) continue;
      const sizes = {};
      for (const w of [noteWide, noteFelt]) {
        if (sizes[w]) continue;
        setVar(el, '--app-fw', w);
        if (!el.hasAttribute('data-app-fl')) el.setAttribute('data-app-fl', '');
        sizes[w] = rectOf(el);
      }
      notes.push({ el, sizes });
    }
  }
  const tagSize = new Map();
  for (const el of scene.querySelectorAll('.seat-pod.seat-pod--app > .seat-pod__winner-label')) {
    if (shown(el)) tagSize.set(el, tagSizes(el));
  }

  // ── reads ──
  const top = hud && hud.querySelector('.hud-top');
  const bar = hud && hud.querySelector('.hud-bottom');
  const bTop = top && shown(top) ? top.getBoundingClientRect().bottom + 2 : 2;
  const bBot = bar && shown(bar) ? bar.getBoundingClientRect().top - 2 : VH - 2;
  const B = { x: 2, y: bTop, w: W - 4, h: Math.max(20, bBot - bTop) };
  // (repair 2) a seat's labels live in the scene, which clips at its edges
  const SR = rectOf(scene);
  const bsTop = Math.max(B.y, SR.y + 1);
  const BS = { x: Math.max(B.x, SR.x + 1), y: bsTop, w: Math.min(B.x + B.w, SR.x + SR.w - 1) - Math.max(B.x, SR.x + 1), h: Math.max(20, Math.min(B.y + B.h, SR.y + SR.h - 1) - bsTop) };
  // what the labels must not cover, weighted by what covering it costs
  // (a card, the pot or a name more than an open seat's pill or the pile)
  const obs = [];
  const add = (wt) => (el) => { if (shown(el)) obs.push({ ...rectOf(el), wt }); };
  const pods = Array.from(scene.querySelectorAll('.seat-pod.seat-pod--app'));
  const heroPod = pods.find((p) => p.classList.contains('seat-pod--app-hero')) || null;
  for (const pod of pods) {
    if (pod === heroPod) continue;
    const open = pod.classList.contains('seat-pod--empty');
    const folded = pod.classList.contains('seat-pod--folded');
    pod.querySelectorAll(`${POD_PARTS}, :scope > .dealer-btn`).forEach(add(open ? 1 : folded ? 2 : 3));
    // (repair 2) the badges that stand out of the plate / avatar: VIP, AWAY
    pod.querySelectorAll(':scope > .seat-pod__nameplate .np-vip, :scope > .seat-pod__avatar-wrap .seat-pod__away-badge').forEach(add(3));
    if (shown(pod)) obs.push({ ...rectOf(pod), own: pod, wt: 1 });
  }
  // (the felt's POT plate repeats the strip's TOTAL POT: cheaper to cover)
  scene.querySelectorAll('.table2d-pot-area > .table2d-pot-label').forEach(add(1.5));
  // (repair 2: and the pot's own box, a little larger than the plate)
  scene.querySelectorAll('.table2d-pot-area').forEach(add(1));
  scene.querySelectorAll('.table2d-pot-area > :not(.table2d-pot-label)').forEach(add(0.5));
  if (hud) {
    // (the HUD draws over the table: a label under these is hidden, so they
    // weigh the most; repair 2: the hero's own tag no longer goes under his
    // cards, where it could not be seen)
    hud.querySelectorAll('.hud-community .community-card').forEach(add(4));
    hud.querySelectorAll('.hud-cards.hud-cards-floating').forEach(add(4));
    hud.querySelectorAll('.hud-nameplate-me, .hud-nameplate-me > .np-title, .hud-nameplate-me > .np-vip, .sit-out-quick-btn--active, .app-spectator-banner').forEach(add(4));
  }
  const fcx = F.x + F.w / 2;
  const boardEls = hud ? Array.from(hud.querySelectorAll('.hud-community .community-card')).filter(shown) : [];
  const board = boardEls.length ? boardEls.map(rectOf).reduce((p, q) => {
    const x = Math.min(p.x, q.x);
    const y = Math.min(p.y, q.y);
    return { x, y, w: Math.max(p.x + p.w, q.x + q.w) - x, h: Math.max(p.y + p.h, q.y + q.h) - y };
  }) : null;

  const done = new Set();
  const writes = [];
  // the texture badge (a help tool) under the board; with no hand-strength
  // pill under it (he folded, he watches) on a small phone his cards sit
  // there, so it moves beside them (or wherever covers least)
  const pill = hud ? hud.querySelector('.hand-strength-portal') : null;
  const badgeEl = hud ? hud.querySelector('.hud-community .board-texture-badge') : null;
  const community = hud ? hud.querySelector('.hud-community') : null;
  let BD = null;
  if (shown(badgeEl) && community) {
    const cr = rectOf(community);
    const br = rectOf(badgeEl);
    const nat = { x: (board ? board.x + board.w / 2 : fcx) - br.w / 2, y: cr.y + cr.h + 7 };
    let spot = { ...nat, w: br.w, h: br.h };
    if (!shown(pill)) {
      const got = pick(br.w, br.h, [
        nat,
        C ? { x: C.x - 3 - br.w, y: C.y + 2 } : null,
        C ? { x: C.x + C.w + 3, y: C.y + 2 } : null,
        C ? { x: C.x - 3 - br.w, y: C.y + C.h - br.h } : null,
        C ? { x: C.x + C.w + 3, y: C.y + C.h - br.h } : null,
        board ? { x: board.x - 3 - br.w, y: board.y + board.h - br.h } : null,
        board ? { x: board.x + board.w + 3, y: board.y + board.h - br.h } : null,
      ], obs, B);
      if (got) spot = got.r;
    }
    BD = spot;
    obs.push({ ...spot, wt: 1 });
    if (Math.abs(spot.x - nat.x) > 0.5 || Math.abs(spot.y - nat.y) > 0.5) {
      done.add(badgeEl);
      writes.push(() => {
        setVar(badgeEl, '--app-fx', spot.x - cr.x);
        setVar(badgeEl, '--app-fy', spot.y - cr.y);
        if (!badgeEl.hasAttribute('data-app-fl')) badgeEl.setAttribute('data-app-fl', '');
      });
    }
  }
  // the hand-strength pill under the texture badge (a long badge wraps to a
  // second line on a narrow felt; the pill steps down with it)
  let P = shown(pill) ? rectOf(pill) : null;
  if (P && BD) {
    const bd = BD;
    const pr = { x: fcx - P.w / 2, y: bd.y + bd.h + 4, w: P.w, h: P.h };
    P = pr;
    done.add(pill);
    writes.push(() => {
      setVar(pill, '--app-fx', pr.x);
      setVar(pill, '--app-fy', pr.y);
      if (!pill.hasAttribute('data-app-fl')) pill.setAttribute('data-app-fl', '');
    });
  }
  if (P) obs.push({ ...P, wt: 3 });
  // place `el` (size w x h) at the first free candidate; `origin` = its
  // containing seat pod's box (then it stays inside the scene: BS), or null
  // (fixed to the viewport). (repair 2) A WINNER tag tries its narrower
  // sizes (tagSize) before it settles for a spot that covers something.
  // (choose: the spot, no side effects; commit: take it)
  const choose = (el, cands, origin, own) => {
    const bounds = origin ? BS : B;
    const sizes = tagSize.get(el) || [{ fw: null, ...rectOf(el) }];
    let got = null;
    for (const sz of sizes) {
      const g = pick(sz.w, sz.h, cands(sz.w, sz.h), obs, bounds, own);
      if (!g) continue;
      if (g.s === 0) return { ...g, fw: sz.fw, compact: !!sz.compact };
      if (!got || g.k < got.k) got = { ...g, fw: sz.fw, compact: !!sz.compact };
    }
    return got;
  };
  const place = (el, cands, origin, own) => {
    const got = choose(el, cands, origin, own);
    if (got) commit(el, got, origin);
  };
  const commit = (el, got, origin) => {
    const { fw, compact } = got;
    obs.push({ ...got.r, wt: 3 });
    done.add(el);
    const ox = origin ? origin.x : 0;
    const oy = origin ? origin.y : 0;
    writes.push(() => {
      if (fw != null) {
        setVar(el, '--app-fw', fw);
        if (!el.hasAttribute('data-app-fw')) el.setAttribute('data-app-fw', '');
      } else if (tagSize.has(el)) {
        el.removeAttribute('data-app-fw');
        el.style.removeProperty('--app-fw');
      }
      if (compact) {
        if (!el.hasAttribute('data-app-compact')) el.setAttribute('data-app-compact', '');
      } else {
        el.removeAttribute('data-app-compact');
      }
      setVar(el, '--app-fx', got.r.x - ox);
      setVar(el, '--app-fy', got.r.y - oy);
      if (!el.hasAttribute('data-app-fl')) el.setAttribute('data-app-fl', '');
    });
  };

  // a) the Split Pot banner (the showdown panel's own copy stays in the panel):
  // over the felt above the board, where the pot was
  if (shown(chop)) {
    place(chop, (w, h) => [
      board ? { x: fcx - w / 2, y: board.y - 5 - h } : { x: fcx - w / 2, y: F.y + F.h * 0.42 - h / 2 },
      { x: fcx - w / 2, y: F.y + 6 },
      P ? { x: fcx - w / 2, y: P.y + P.h + 4 } : null,
      { x: W / 2 - w / 2, y: B.y + 2 },
    ], null);
  }

  // a2) the notices: under the top bar where that is free, else over the
  // felt (between the top row and the hero's cards), else the spot along the
  // screen that covers least
  for (const { el, sizes } of notes) {
    const low = (C ? C.y : F.y + F.h) - 2;
    let best = null;
    const tryAt = (w, list) => {
      const sz = sizes[w];
      if (!sz) return;
      const got = pick(sz.w, sz.h, list(sz.w, sz.h), obs, B);
      if (got && (!best || got.s < best.s)) best = { ...got, w };
    };
    tryAt(noteWide, (w) => [{ x: W / 2 - w / 2, y: B.y + 2 }]);
    if (!best || best.s > 0) {
      tryAt(noteFelt, (w, h) => {
        const list = [];
        for (let y = F.y + 4; y + h <= low; y += 6) list.push({ x: fcx - w / 2, y });
        return list;
      });
    }
    if (!best || best.s > 0) {
      for (const w of [noteWide, noteFelt]) {
        tryAt(w, (ww, h) => {
          const list = [];
          for (let y = B.y + 2; y + h <= B.y + B.h; y += 8) list.push({ x: W / 2 - ww / 2, y }, { x: B.x + 2, y }, { x: B.x + B.w - 2 - ww, y });
          return list;
        });
      }
    }
    if (!best) continue;
    const spot = best.r;
    const fw = best.w;
    obs.push({ ...spot, wt: 3 });
    done.add(el);
    writes.push(() => {
      setVar(el, '--app-fw', fw);
      setVar(el, '--app-fx', spot.x);
      setVar(el, '--app-fy', spot.y);
      if (!el.hasAttribute('data-app-fl')) el.setAttribute('data-app-fl', '');
    });
  }

  // b) the seats' WINNER tags, then their bets: under the plate first (the
  // bet shifted toward the table), else beside the seat toward the table,
  // else (repair 2) the nearest free spot around the seat, the table's side
  // first. Every label first tries its own spots (pass 1: a free one is
  // kept); the rest then search wider (pass 2), so a far label never takes
  // a seat's own spot from it.
  const potC = (() => {
    const pa = scene.querySelector('.table2d-pot-area');
    if (shown(pa)) { const r = rectOf(pa); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
    return { x: fcx, y: F.y + F.h / 2 };
  })();
  const seatLabel = (pod, el, kind, wide) => {
    const pr = pod.getBoundingClientRect();
    const origin = { x: pr.left, y: pr.top };
    const wrap = pod.querySelector(':scope > .seat-pod__avatar-wrap');
    const A = wrap ? rectOf(wrap) : rectOf(pod);
    const plateEl = pod.querySelector(':scope > .seat-pod__nameplate');
    const Pl = shown(plateEl) ? rectOf(plateEl) : { x: A.x, y: A.y + A.h - 6, w: A.w, h: 6 };
    const side = pod.classList.contains('seat-pod--app-l') ? 1 : pod.classList.contains('seat-pod--app-r') ? -1 : 0;
    const acx = A.x + A.w / 2;
    const betX = kind === 'bet' ? (parseFloat(pod.style.getPropertyValue('--app-bet-x')) || 0) : 0;
    const own = (w, h) => {
      const under = Pl.y + Pl.h + 2;
      const inX = side > 0 ? Pl.x + Pl.w + 3 : Pl.x - 3 - w;
      const inAv = side > 0 ? A.x + A.w + 3 : A.x - 3 - w;
      const list = [
        { x: clampX(acx + betX - w / 2, w, BS), y: under },
        { x: clampX(acx - w / 2, w, BS), y: under },
        { x: clampX(side > 0 ? Pl.x : Pl.x + Pl.w - w, w, BS), y: under },
      ];
      if (side !== 0) {
        list.push(
          { x: inX, y: Pl.y + Pl.h - h },
          { x: inX, y: Pl.y + Pl.h / 2 - h / 2 },
          { x: inX, y: Pl.y },
          { x: inAv, y: A.y + A.h / 2 - h / 2 },
          { x: inX, y: Pl.y + Pl.h + 2 },
        );
      } else {
        list.push({ x: A.x + A.w + 3, y: A.y + A.h / 2 - h / 2 }, { x: A.x - 3 - w, y: A.y + A.h / 2 - h / 2 });
      }
      list.push({ x: clampX(acx - w / 2, w, BS), y: A.y - 3 - h });
      // (repair 2) a tight spot: snug under the plate
      list.push(
        { x: clampX(acx + betX - w / 2, w, BS), y: under - 1.5 },
        { x: clampX(acx - w / 2, w, BS), y: under - 1.5 },
      );
      return list;
    };
    if (!wide) {
      // pass 1: only a free spot of its own counts
      const r = rectOf(el);
      const got = pick(r.w, r.h, own(r.w, r.h), obs, BS, pod);
      if (!got || got.s > 0) return null;
      place(el, () => [got.r], origin, pod);
      return null;
    }
    // pass 2: its own spots, then rings around the seat's centre (between
    // its avatar and its plate)
    const c = { x: acx, y: (A.y + A.h / 2 + Pl.y + Pl.h / 2) / 2 };
    const cands = (w, h) => {
      const r0 = Math.max(10, Math.round(Math.min(w, h) / 2));
      return [...own(w, h), ...rings(c, potC, w, h, r0, r0 + 120)];
    };
    return { el, origin, pod, cands };
  };
  const seatJobs = [];
  for (const pod of pods) {
    if (pod === heroPod) continue;
    const win = pod.querySelector(':scope > .seat-pod__winner-label');
    if (shown(win)) seatJobs.push([pod, win, 'win']);
  }
  for (const pod of pods) {
    if (pod === heroPod) continue;
    const bet = pod.querySelector(':scope > .chip-stack');
    if (shown(bet)) seatJobs.push([pod, bet, 'bet']);
  }
  const seatLater = seatJobs.filter(([pod, el, kind]) => {
    seatLabel(pod, el, kind, false);
    return !done.has(el);
  });

  // c) the hero's WINNER tag, bet and dealer button: beside his cards
  let heroLater = null;
  if (heroPod && C) {
    const hr = heroPod.getBoundingClientRect();
    const origin = { x: hr.left, y: hr.top };
    const beside = (w, h) => [
      { x: C.x - 4 - w, y: C.y + C.h / 2 - h / 2 },
      { x: C.x + C.w + 4, y: C.y + C.h / 2 - h / 2 },
      { x: C.x - 4 - w, y: C.y },
      { x: C.x + C.w + 4, y: C.y },
      { x: C.x - 4 - w, y: C.y + C.h - h },
      { x: C.x + C.w + 4, y: C.y + C.h - h },
      { x: C.x - 2 - w, y: C.y + C.h / 2 - h / 2 },
      { x: C.x + C.w + 2, y: C.y + C.h / 2 - h / 2 },
      { x: C.x - 2 - w, y: C.y },
      { x: C.x + C.w + 2, y: C.y },
      { x: C.x, y: C.y - 2 - h },
      { x: C.x + C.w - w, y: C.y - 2 - h },
      { x: C.x + C.w / 2 - w / 2, y: C.y - 2 - h },
      { x: C.x - w / 2, y: C.y - 2 - h },
      { x: C.x + C.w - w / 2, y: C.y - 2 - h },
    ];
    // (repair 2) when none of those is free: the nearest free spot around his
    // cards, the table's side first (never under his cards: the HUD draws
    // them over the table, so a tag there could not be seen)
    const around = (w, h, a = 0, b = 150) => rings({ x: C.x + C.w / 2, y: C.y + C.h / 2 }, potC, w, h, Math.round(C.h / 2) + a, Math.round(C.h / 2) + b);
    const win = heroPod.querySelector(':scope > .seat-pod__winner-label');
    if (shown(win)) {
      // beside his cards, else near them, else above the board, else farther
      place(win, (w, h) => [
        ...beside(w, h),
        ...around(w, h, 0, 60),
        board ? { x: fcx - w / 2, y: board.y - 5 - h } : null,
        { x: fcx - w / 2, y: F.y + 6 },
        ...around(w, h, 66, 150),
      ], origin);
    }
    // (his bet: beside his cards when free, else it searches with the seats'
    // labels in pass 2)
    const bet = heroPod.querySelector(':scope > .chip-stack');
    if (shown(bet)) {
      const r = rectOf(bet);
      const got = pick(r.w, r.h, beside(r.w, r.h), obs, BS);
      if (got && got.s === 0) commit(bet, got, origin);
      else heroLater = { el: bet, origin, pod: undefined, cands: (w, h) => [...beside(w, h), ...around(w, h)] };
    }
    const dealer = heroPod.querySelector(':scope > .dealer-btn');
    if (shown(dealer)) {
      place(dealer, (w, h) => [
        { x: C.x + C.w + 4, y: C.y + 2 },
        { x: C.x - 4 - w, y: C.y + 2 },
        { x: C.x + C.w + 4, y: C.y + C.h - h - 2 },
        { x: C.x - 4 - w, y: C.y + C.h - h - 2 },
        { x: C.x + C.w - w / 2, y: C.y - h / 2 },
        { x: C.x - w / 2, y: C.y - h / 2 },
      ], origin);
    }
  }
  // b2) pass 2: the seats' labels whose own spots were taken search wider,
  // the hardest first (the one whose best spot is farthest, or covers
  // something), so a label with room to spare does not take the last free
  // spot of another
  if (seatLater.length || heroLater) {
    const specs = seatLater.map(([pod, el, kind]) => seatLabel(pod, el, kind, true));
    if (heroLater) specs.push(heroLater);
    const hard = specs.map((sp) => {
      const g = choose(sp.el, sp.cands, sp.origin, sp.pod);
      return { sp, bad: !g ? -1 : g.s > 0 ? 1e9 + g.k : g.k };
    });
    hard.sort((p, q) => q.bad - p.bad);
    for (const { sp } of hard) place(sp.el, sp.cands, sp.origin, sp.pod);
  }

  // d) the outs counter (a help tool; GameHUD draws it only where help tools
  // are on): under the hand-strength pill, else beside the hero's cards, else
  // at the felt's top, else under the top bar's corners
  if (hasOuts && outsSize[outsWide]) {
    const below = P ? P.y + P.h + 4 : (board ? board.y + board.h + 6 : F.y + F.h * 0.7);
    const spots = [
      [outsWide, (w) => ({ x: fcx - w / 2, y: below })],
      [outsSide, (w, h) => (C ? { x: C.x - 4 - w, y: C.y + C.h / 2 - h / 2 } : null)],
      [outsSide, (w, h) => (C ? { x: C.x + C.w + 4, y: C.y + C.h / 2 - h / 2 } : null)],
      [outsSide, (w, h) => (C ? { x: C.x - 4 - w, y: C.y + C.h - h } : null)],
      [outsSide, (w, h) => (C ? { x: C.x + C.w + 4, y: C.y + C.h - h } : null)],
      [outsSide, (w) => (C ? { x: C.x - 4 - w, y: C.y } : null)],
      [outsSide, () => (C ? { x: C.x + C.w + 4, y: C.y } : null)],
      [outsWide, (w) => ({ x: fcx - w / 2, y: F.y + 4 })],
      [outsCorner, () => ({ x: B.x + 4, y: B.y + 2 })],
      [outsCorner, (w) => ({ x: B.x + B.w - 4 - w, y: B.y + 2 })],
    ];
    let best = null;
    for (const [w, at] of spots) {
      const sz = outsSize[w];
      if (!sz) continue;
      const got = pick(sz.w, sz.h, [at(sz.w, sz.h)], obs, B);
      if (got && (!best || got.s < best.s)) best = { ...got, w };
      if (best && best.s === 0) break;
    }
    // a crowded small phone: the spot along the screen's edges that covers least
    if (best && best.s > 0) {
      for (const w of [outsCorner, outsSide]) {
        const sz = outsSize[w];
        if (!sz) continue;
        const cands = [];
        for (let y = B.y + 2; y + sz.h <= B.y + B.h; y += 8) {
          cands.push({ x: B.x + 2, y }, { x: B.x + B.w - 2 - sz.w, y }, { x: fcx - sz.w / 2, y });
        }
        const got = pick(sz.w, sz.h, cands, obs, B);
        if (got && got.s < best.s) best = { ...got, w };
      }
    }
    if (best) {
      obs.push({ ...best.r, wt: 3 });
      done.add(outs);
      writes.push(() => {
        setVar(outs, '--app-fw', best.w);
        setVar(outs, '--app-fx', best.r.x);
        setVar(outs, '--app-fy', best.r.y);
        if (!outs.hasAttribute('data-app-fl')) outs.setAttribute('data-app-fl', '');
      });
    }
  }

  // ── writes ──
  for (const fn of writes) fn();
  for (const el of prev) if (!done.has(el)) release(el);
  if (outs && !done.has(outs) && outs.hasAttribute('data-app-fl')) release(outs);
  if (chop && !done.has(chop)) chop.style.removeProperty('--app-fw');
}

// GameHUD -> PokerTable2D: "the HUD changed, measure and place again"
let pingFn = null;
export function setAppLayoutPing(fn) { pingFn = fn; }
export function appLayoutPing() { if (pingFn) pingFn(); }
