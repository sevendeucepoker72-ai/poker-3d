// APP Precision final repair 1: the skin's state classes on the page root.
// The skin CSS asked "does the HUD hold X?" with :has() (155 rules); Chrome
// re-checked those on every table update, about 5x live's style time. These
// classes answer the same questions: set from the DOM after each HUD render
// and after each change inside the HUD (a MutationObserver: the hand review,
// toasts and the session panel render on their own). Switch on only.
// A rule that had :has() repeats its flag class where needed to keep the
// specificity the :has() had (AppPrecision*.css).
import { cinematicEnabled } from './cinematicSkin';
import { appLayoutPing } from './appPlacement';

// [class on <html>, what the cinematic HUD must hold]
const HUD_FLAGS = [
  ['app-h-turn', '.hud-bottom--my-turn'],
  ['app-h-pha', '.post-hand-analysis'],
  ['app-h-rabbit', '.rabbit-hunt-btn'],
  ['app-h-muck', '.show-muck-prompt'],
  ['app-h-so', '.sit-out-quick-btn--active'],
  ['app-h-tnote', '.tournament-sitout-note'],
  ['app-h-toast', '.toast-stack'],
  ['app-h-winner', '.winner-banner'],
  ['app-h-sd', '.showdown-overlay'],
  ['app-h-hsp', '.hand-strength-portal'],
  ['app-h-hspplain', '.hand-strength-portal--plain'],
  ['app-h-bomb', '.bomb-pot-banner'],
  ['app-h-eq', '.equity-badges-container'],
  ['app-h-outs', '.hand-strength-container .outs-display'],
  ['app-h-specban', '.app-spectator-banner'],
  ['app-h-specrow', '.app-spec-row'],
  ['app-h-train', '.app-top .hud-training-badge'],
  ['app-h-trainc', '.app-top > .hud-training-badge'],
  ['app-h-info', '.app-top > .app-info'],
  ['app-h-callmeta', '.action-btn.call .action-meta-row'],
  ['app-h-slot', '.hud-cards.hud-cards-floating .card-slot'],
  ['app-h-stp', '.session-tracker .session-tracker-panel'],
  ['app-h-plate', '.hud-bottom-panel > .hud-nameplate-me'],
  ['app-h-3c', '.hud-cards.hud-cards-floating:not(.hud-cards-many) > .card-peek:nth-child(3)'],
];
const HUD_ON = 'app-cin-hud';
const TABLE_ACTIVE = 'app-t-active';
const ALL = [HUD_ON, ...HUD_FLAGS.map((f) => f[0])];
const UNION = HUD_FLAGS.map((f) => f[1]).join(', ');

let hudEl = null;
let mo = null;

function watch(hud) {
  if (hud === hudEl) return;
  if (mo) mo.disconnect();
  hudEl = hud;
  mo = null;
  if (!hud || typeof MutationObserver === 'undefined') return;
  mo = new MutationObserver(() => {
    // (a flag that changed moves what the table measures)
    if (syncAppHudFlags()) appLayoutPing();
  });
  mo.observe(hud, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

// Returns true when a class changed.
export function syncAppHudFlags() {
  if (!cinematicEnabled || typeof document === 'undefined') return false;
  const root = document.documentElement;
  const hud = hudEl && hudEl.isConnected ? hudEl : document.querySelector('.hud.cinematic-hud');
  const on = new Set();
  if (hud) {
    on.add(HUD_ON);
    for (const el of hud.querySelectorAll(UNION)) {
      for (const [cls, sel] of HUD_FLAGS) if (!on.has(cls) && el.matches(sel)) on.add(cls);
    }
  }
  let changed = false;
  for (const cls of ALL) {
    const want = on.has(cls);
    if (root.classList.contains(cls) !== want) { root.classList.toggle(cls, want); changed = true; }
  }
  // a toast while the winner banner shows goes just under the banner
  // (AppPrecisionStates.css section 24): the banner's foot and the toast
  // stack's height, read only while both show (layout boxes, so the
  // banner's slide-in transform does not count)
  let wb = null;
  if (hud && on.has('app-h-winner') && on.has('app-h-toast')) {
    const b = hud.querySelector('.winner-banner');
    const t = hud.querySelector('.toast-stack');
    if (b && t) wb = [`${Math.round(b.offsetTop + b.offsetHeight)}px`, `${Math.round(t.offsetHeight)}px`];
  }
  if (rootVar(root, '--app-wb-b', wb && wb[0])) changed = true;
  if (rootVar(root, '--app-toast-h', wb && wb[1])) changed = true;
  watch(hud);
  return changed;
}

function rootVar(root, k, v) {
  const cur = root.style.getPropertyValue(k);
  if (v == null) {
    if (!cur) return false;
    root.style.removeProperty(k);
    return true;
  }
  if (cur === v) return false;
  root.style.setProperty(k, v);
  return true;
}

export function releaseAppHudFlags() {
  if (!cinematicEnabled || typeof document === 'undefined') return;
  watch(null);
  const root = document.documentElement;
  for (const cls of ALL) root.classList.remove(cls);
  root.style.removeProperty('--app-wb-b');
  root.style.removeProperty('--app-toast-h');
}

// The table's one flag: a seat is to act (the other seats dim).
export function syncAppTableFlags(scene) {
  if (!cinematicEnabled || typeof document === 'undefined') return;
  const want = !!(scene && scene.querySelector('.seat-pod--active'));
  const root = document.documentElement;
  if (root.classList.contains(TABLE_ACTIVE) !== want) root.classList.toggle(TABLE_ACTIVE, want);
}
