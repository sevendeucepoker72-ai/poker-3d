import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './SettingsPanel.css';
import { getSocket } from '../../services/socketService';
import { useProgressStore, isItemOwned, equippedIdFor } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { loadSettings, saveSettings, FONT_SIZE_OPTIONS } from '../../services/settingsPrefs';
import { CARD_BACKS, THEMES, FREE_DEFAULTS, shopErrorText } from '../../utils/economyCatalog';
import {
  isPushSupported,
  isIosNonStandalone,
  subscribeToPush,
  unsubscribeFromPush,
  getPushStatus,
  pushNeedsAccountSignIn,
} from '../../hooks/usePushNotifications';

// 2026-10-11 (.online R2 — APPUI-26). Every control here does something:
// - sound, font size, colour-blind suits, four-colour deck, hand-strength and
//   pot-odds toggles, skip all-in confirm — stored per tab
//   (services/settingsPrefs, the keys the table reads), applied to the page,
//   and mirrored to the account (updatePreferences) so they follow him;
// - card back and table felt are his EQUIPPED cosmetics (C7): picking one
//   equips it on the server (equipItem) — the table draws what the server
//   says he has equipped;
// - auto-muck and turn-timer were never read by anything (the server decides
//   both) and are gone.

// Debounced server sync for preferences — persists across devices.
let _prefsSyncTimer = null;
function schedulePrefsSync(settings) {
  if (_prefsSyncTimer) clearTimeout(_prefsSyncTimer);
  _prefsSyncTimer = setTimeout(() => {
    _prefsSyncTimer = null;
    const socket = getSocket();
    if (socket && socket.connected) socket.emit('updatePreferences', settings);
  }, 400);
}

/** One owned-cosmetic picker row (card backs / table felts) — equips on the server. */
function EquipPicker({ type, items, swatch }) {
  const progress = useProgressStore((s) => s.progress);
  const [pending, setPending] = useState(null);
  const [msg, setMsg] = useState(null);
  const owned = items.filter((it) => isItemOwned(progress, type, it.id, { free: it.price === 0 }));
  const current = equippedIdFor(progress, type) || FREE_DEFAULTS[type] || null;

  useEffect(() => {
    if (!pending) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const onResult = (res) => {
      if (res && res.itemType && res.itemType !== type) return;
      setPending(null);
      setMsg(res && res.success ? null : shopErrorText(res && res.error, 'Could not change it — try again.'));
    };
    socket.on('equipResult', onResult);
    const t = setTimeout(() => { setPending(null); setMsg('The game server did not answer — try again.'); }, 10000);
    return () => { clearTimeout(t); socket.off('equipResult', onResult); };
  }, [pending, type]);

  const pick = (id) => {
    if (id === current || pending) return;
    const socket = getSocket();
    if (!socket || !socket.connected) { setMsg('Not connected — try again in a moment.'); return; }
    setMsg(null);
    setPending(id);
    socket.emit('equipItem', { itemType: type, itemId: id });
  };

  return (
    <>
      <div className="settings-radio-group">
        {owned.map((it) => (
          <label key={it.id} className="settings-radio-item">
            <input
              type="radio"
              name={`equip-${type}`}
              value={it.id}
              checked={current === it.id}
              disabled={!!pending}
              onChange={() => pick(it.id)}
            />
            <span className="settings-radio-label">
              <span className="settings-radio-swatch" style={swatch(it)} />
              {it.name}{pending === it.id ? ' …' : ''}
            </span>
          </label>
        ))}
      </div>
      <span className="settings-hint">More in the Shop. {msg ? <span className="settings-hint-error">{msg}</span> : null}</span>
    </>
  );
}

export default function SettingsPanel({ onClose }) {
  // The settings in effect in this tab (the account's saved ones are applied
  // at sign-in when the tab has none of its own — persistenceService).
  const [settings, setSettings] = useState(() => loadSettings());

  // Push notification enrollment state
  const userId = useGameStore((s) => s.userId);
  const supportsPush = isPushSupported();
  const iosGuidance = isIosNonStandalone();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!supportsPush || !userId) return;
    getPushStatus(userId).then((s) => {
      if (!cancelled) setPushEnabled(!!(s && (s.push_enabled || s.has_subscription)));
    });
    return () => { cancelled = true; };
  }, [supportsPush, userId]);

  const togglePush = async () => {
    if (!userId || pushBusy) return;
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush(userId);
        setPushEnabled(false);
      } else {
        const ok = await subscribeToPush(userId);
        if (!ok) {
          // 2026-10-10 (F5) — a Play Online tab without a sign-in of its own
          // account on this browser cannot enroll push (it is per account).
          setPushError(pushNeedsAccountSignIn()
            ? 'Push notifications need your American Pub Poker sign-in on this device.'
            : Notification.permission === 'denied'
              ? 'Notifications are blocked in your browser settings. Allow them to enable.'
              : 'Could not enable push. Try again.');
        } else {
          setPushEnabled(true);
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  // Save whenever settings change — this tab (and the page) + the account.
  useEffect(() => {
    saveSettings(settings);
    schedulePrefsSync(settings);
  }, [settings]);

  // Close on escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleRow = (key, label, hint) => (
    <div className="settings-row">
      <span className="settings-label">
        {label}
        {hint && <span className="settings-row-hint">{hint}</span>}
      </span>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={!!settings[key]}
          onChange={(e) => update(key, e.target.checked)}
        />
        <span className="settings-toggle-track" />
        <span className="settings-toggle-knob" />
      </label>
    </div>
  );

  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>Close</button>
        </div>

        {/* ===== NOTIFICATIONS ===== */}
        <div className="settings-section">
          <div className="settings-section-title">Notifications</div>

          {!supportsPush && (
            <div className="settings-row" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              This browser does not support push notifications.
            </div>
          )}

          {supportsPush && iosGuidance && (
            <div className="settings-row" style={{ color: '#fbbf24', fontSize: '0.85rem', lineHeight: 1.4 }}>
              On iPhone: Tap <strong>Share → Add to Home Screen</strong>, then open the app from your home screen to enable notifications.
            </div>
          )}

          {supportsPush && !iosGuidance && (
            <div className="settings-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <span className="settings-label">Push notifications</span>
              <button
                className="btn-accent"
                onClick={togglePush}
                disabled={pushBusy || !userId}
                style={{
                  padding: '6px 14px',
                  minHeight: 40,
                  fontSize: '0.85rem',
                  background: pushEnabled ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                  color: '#fff',
                }}
              >
                {pushBusy ? 'Working…' : pushEnabled ? '✓ Enabled — tap to turn off' : 'Turn on'}
              </button>
              {pushError && (
                <div style={{ flexBasis: '100%', color: '#93c5fd', fontSize: '0.78rem', marginTop: '4px' }}>
                  {pushError}
                </div>
              )}
              {!userId && (
                <div style={{ flexBasis: '100%', color: '#94a3b8', fontSize: '0.78rem', marginTop: '4px' }}>
                  Log in to enable notifications.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===== SOUND ===== */}
        <div className="settings-section">
          <div className="settings-section-title">Sound</div>

          <div className="settings-row">
            <span className="settings-label">Master Volume</span>
            <span className="settings-value">{settings.muteAll ? 'Muted' : settings.masterVolume}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.masterVolume}
              onChange={(e) => update('masterVolume', Number(e.target.value))}
              className={`settings-slider${settings.muteAll ? ' disabled' : ''}`}
            />
          </div>

          <div className="settings-row">
            <span className="settings-label">SFX Volume</span>
            <span className="settings-value">{settings.muteAll ? 'Muted' : settings.sfxVolume}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.sfxVolume}
              onChange={(e) => update('sfxVolume', Number(e.target.value))}
              className={`settings-slider${settings.muteAll ? ' disabled' : ''}`}
            />
          </div>

          <div className="settings-row">
            <span className="settings-label">Music / Ambient</span>
            <span className="settings-value">{settings.muteAll ? 'Muted' : settings.musicVolume}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.musicVolume}
              onChange={(e) => update('musicVolume', Number(e.target.value))}
              className={`settings-slider${settings.muteAll ? ' disabled' : ''}`}
            />
          </div>

          {toggleRow('muteAll', 'Mute All')}
        </div>

        {/* ===== GAMEPLAY ===== */}
        <div className="settings-section">
          <div className="settings-section-title">Gameplay</div>
          {toggleRow('showHandStrength', 'Show hand strength', 'The strength pill and the equity line on Call')}
          {toggleRow('showPotOdds', 'Show pot odds', 'The pot-odds badge and the odds line on Call')}
          {toggleRow('skipAllInConfirmation', 'Skip All-In Confirmation', 'Go all-in immediately without confirmation popup')}
        </div>

        {/* ===== DISPLAY ===== */}
        <div className="settings-section">
          <div className="settings-section-title">Display</div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
            <span className="settings-label">Card back <span className="settings-row-hint">Everyone at your table sees it</span></span>
            <EquipPicker type="card_back" items={CARD_BACKS} swatch={(it) => ({ background: it.color })} />
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
            <span className="settings-label">Table felt <span className="settings-row-hint">The felt you see at every table</span></span>
            <EquipPicker type="theme" items={THEMES} swatch={(it) => ({ background: it.felt, border: `2px solid ${it.rail}` })} />
          </div>

          {toggleRow('fourColorDeck', 'Four-color deck', 'Diamonds blue, clubs green for easier reading')}

          {/* Font Size */}
          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
            <span className="settings-label">Font Size</span>
            <div className="settings-radio-group">
              {FONT_SIZE_OPTIONS.map((opt) => (
                <label key={opt.key} className="settings-radio-item">
                  <input
                    type="radio"
                    name="fontSize"
                    value={opt.key}
                    checked={settings.fontSize === opt.key}
                    onChange={() => update('fontSize', opt.key)}
                  />
                  <span className="settings-radio-label">
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {toggleRow('colorBlindMode', 'Color Blind Mode', 'Blue and orange suits instead of black and red (overrides four-color)')}
        </div>

        {/* ===== APP ===== */}
        <div className="settings-section">
          <div className="settings-section-title">App</div>
          <div className="settings-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <span className="settings-label">Check for updates</span>
            <button
              className="btn-accent"
              style={{
                padding: '6px 14px',
                minHeight: 40,
                fontSize: '0.85rem',
                background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                color: '#fff',
              }}
              onClick={async () => {
                // Force a fresh load from the network, bypassing the service
                // worker cache: unregister the SW, clear caches, hard-reload.
                try {
                  if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map((r) => r.unregister()));
                  }
                  if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((k) => caches.delete(k)));
                  }
                } catch { /* ignore — reload will still fetch fresh network */ }
                window.location.reload();
              }}
            >
              Force reload
            </button>
            <span style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.3, width: '100%' }}>
              Clears the cached app bundle and fetches the latest version.
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
