/**
 * Player settings (2026-10-11, .online R2 — APPUI-26).
 *
 * One module for the Settings panel's values: stored per tab in
 * sessionStorage `app_poker_settings` (the key the table's sound hook and the
 * HUD already read), mirrored to the account with `updatePreferences`
 * (users.preferences) so they follow the player to another device, and
 * applied to the page as root classes so every setting does something:
 *   - font size / colour-blind suits / four-colour deck — root attributes +
 *     getCardColor (utils/cardUtils.js);
 *   - "Show hand strength" / "Show pot odds" off — `pref-hide-*` classes that
 *     hide the table's strength pill / equity line and pot-odds badge / line
 *     (src/prefs.css).
 * Settings that the server decides (turn timer, auto-muck) are not offered.
 */
import '../prefs.css';

export const SETTINGS_KEY = 'app_poker_settings';
const SETTINGS_3D_KEY = 'poker3d_settings';
export const SETTINGS_EVENT = 'poker:settings-changed';

export const DEFAULT_SETTINGS = {
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 30,
  muteAll: false,

  showHandStrength: true,
  showPotOdds: true,
  skipAllInConfirmation: false,

  fourColorDeck: false,
  fontSize: 'medium',
  colorBlindMode: false,
};

/** Keys a server `preferences` object may restore (anything else it holds is ignored). */
const RESTORABLE = new Set([...Object.keys(DEFAULT_SETTINGS), 'quickShowdown']);

export const FONT_SIZE_OPTIONS = [
  { key: 'small', label: 'Small', scale: 0.85 },
  { key: 'medium', label: 'Medium', scale: 1.0 },
  { key: 'large', label: 'Large', scale: 1.15 },
];

function readStored() {
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

/** The settings in effect (stored values over the defaults). */
export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(readStored() || {}) };
}

/** Store + apply + tell same-tab readers (the table's sound hook, the HUD). */
export function saveSettings(settings) {
  const merged = { ...(readStored() || {}), ...settings };
  try {
    sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    sessionStorage.setItem(SETTINGS_3D_KEY, JSON.stringify(merged));
  } catch { /* ignore */ }
  applySettingsToDocument(merged);
  // R1 (TABLEUI-13 / APPUI-8) — 'storage' only fires in OTHER tabs.
  try { window.dispatchEvent(new Event(SETTINGS_EVENT)); } catch { /* ignore */ }
}

/** Root classes / attributes for the settings that change how the page looks. */
export function applySettingsToDocument(settings) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const root = document.documentElement;
  const option = FONT_SIZE_OPTIONS.find((o) => o.key === s.fontSize) || FONT_SIZE_OPTIONS[1];
  try {
    root.style.setProperty('--font-scale', String(option.scale));
    root.style.setProperty('--font-scale-pct', `${Math.round(option.scale * 100)}%`);
    root.setAttribute('data-font-scale', option.key);
    root.style.fontSize = `calc(16px * ${option.scale})`;
  } catch { /* ignore */ }
  const toggle = (cls, on) => { try { root.classList.toggle(cls, !!on); } catch { /* ignore */ } };
  toggle('color-blind-mode', s.colorBlindMode);
  toggle('pref-four-color-deck', s.fourColorDeck && !s.colorBlindMode);
  toggle('pref-hide-hand-strength', s.showHandStrength === false);
  toggle('pref-hide-pot-odds', s.showPotOdds === false);
}

/**
 * The account's saved settings (durableState.preferences): applied when this
 * tab has none of its own yet (a new device / tab), so the player's choices
 * follow him. A tab with its own settings keeps them.
 */
export function applyServerPreferences(prefs) {
  if (!prefs || typeof prefs !== 'object') return false;
  if (readStored()) return false;
  const picked = {};
  for (const [k, v] of Object.entries(prefs)) if (RESTORABLE.has(k)) picked[k] = v;
  if (Object.keys(picked).length === 0) return false;
  saveSettings({ ...DEFAULT_SETTINGS, ...picked });
  return true;
}

// Apply the stored settings as soon as the app loads (before any screen).
try { applySettingsToDocument(readStored() || DEFAULT_SETTINGS); } catch { /* ignore */ }
