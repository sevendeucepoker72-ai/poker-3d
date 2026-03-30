import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './SettingsPanel.css';

const STORAGE_KEY = 'app_poker_settings';
const SETTINGS_3D_KEY = 'poker3d_settings';

const DEFAULT_SETTINGS = {
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 30,
  muteAll: false,

  autoMuckLosing: true,
  showHandStrength: true,
  showPotOdds: true,
  skipAllInConfirmation: false,
  turnTimer: '30',

  cardBack: 'classic-red',
  fourColorDeck: false,
  feltColor: '#1e5e3a',
  fontSize: 'medium',
  colorBlindMode: false,
};

const FONT_SIZE_OPTIONS = [
  { key: 'small', label: 'Small', scale: 0.85 },
  { key: 'medium', label: 'Medium', scale: 1.0 },
  { key: 'large', label: 'Large', scale: 1.15 },
];

const CARD_BACKS = [
  { key: 'classic-red', label: 'Classic Red', color: '#b91c1c' },
  { key: 'blue-diamond', label: 'Blue Diamond', color: '#1d4ed8' },
  { key: 'green-felt', label: 'Green Felt', color: '#15803d' },
  { key: 'black-gold', label: 'Black Gold', color: '#1a1a1a' },
];

const FELT_COLORS = [
  { color: '#1e5e3a', label: 'Classic Green' },
  { color: '#1a3a6e', label: 'Royal Blue' },
  { color: '#5e1e1e', label: 'Wine Red' },
  { color: '#2d2d2d', label: 'Charcoal' },
  { color: '#3e2a5e', label: 'Purple' },
  { color: '#1e4e4e', label: 'Teal' },
];

const TIMER_OPTIONS = [
  { value: '15', label: '15 seconds' },
  { value: '20', label: '20 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '45', label: '45 seconds' },
];

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Also save to poker3d_settings key for cross-component access
    localStorage.setItem(SETTINGS_3D_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

function applyFontScale(fontSizeKey) {
  const option = FONT_SIZE_OPTIONS.find((o) => o.key === fontSizeKey) || FONT_SIZE_OPTIONS[1];
  document.documentElement.style.setProperty('--font-scale', String(option.scale));
}

function applyColorBlindMode(enabled) {
  if (enabled) {
    document.documentElement.classList.add('color-blind-mode');
  } else {
    document.documentElement.classList.remove('color-blind-mode');
  }
}

// Apply settings on initial load (before component mounts)
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.fontSize) applyFontScale(parsed.fontSize);
    if (parsed.colorBlindMode) applyColorBlindMode(true);
  }
} catch { /* ignore */ }

export default function SettingsPanel({ onClose }) {
  const [settings, setSettings] = useState(loadSettings);

  // Save whenever settings change
  useEffect(() => {
    saveSettings(settings);
    applyFontScale(settings.fontSize);
    applyColorBlindMode(settings.colorBlindMode);
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

  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>Close</button>
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

          <div className="settings-row">
            <span className="settings-label">Mute All</span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.muteAll}
                onChange={(e) => update('muteAll', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>
        </div>

        {/* ===== GAMEPLAY ===== */}
        <div className="settings-section">
          <div className="settings-section-title">Gameplay</div>

          <div className="settings-row">
            <span className="settings-label">Auto-muck losing hands</span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.autoMuckLosing}
                onChange={(e) => update('autoMuckLosing', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>

          <div className="settings-row">
            <span className="settings-label">Show hand strength meter</span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.showHandStrength}
                onChange={(e) => update('showHandStrength', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>

          <div className="settings-row">
            <span className="settings-label">Show pot odds</span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.showPotOdds}
                onChange={(e) => update('showPotOdds', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>

          <div className="settings-row">
            <span className="settings-label">
              Skip All-In Confirmation
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#8888AA', marginTop: '2px' }}>
                Go all-in immediately without confirmation popup
              </span>
            </span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.skipAllInConfirmation}
                onChange={(e) => update('skipAllInConfirmation', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>

          <div className="settings-row">
            <span className="settings-label">Turn timer duration</span>
            <select
              className="settings-dropdown"
              value={settings.turnTimer}
              onChange={(e) => update('turnTimer', e.target.value)}
            >
              {TIMER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ===== DISPLAY ===== */}
        <div className="settings-section">
          <div className="settings-section-title">Display</div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
            <span className="settings-label">Card back style</span>
            <div className="settings-radio-group">
              {CARD_BACKS.map((cb) => (
                <label key={cb.key} className="settings-radio-item">
                  <input
                    type="radio"
                    name="cardBack"
                    value={cb.key}
                    checked={settings.cardBack === cb.key}
                    onChange={() => update('cardBack', cb.key)}
                  />
                  <span className="settings-radio-label">
                    <span
                      className="settings-radio-swatch"
                      style={{
                        background: cb.color,
                        border: cb.key === 'black-gold' ? '1px solid #FFD700' : undefined,
                      }}
                    />
                    {cb.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-label">
              Four-color deck
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#8888AA', marginTop: '2px' }}>
                Diamonds blue, clubs green for easier reading
              </span>
            </span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.fourColorDeck}
                onChange={(e) => update('fourColorDeck', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>

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

          {/* Color Blind Mode */}
          <div className="settings-row">
            <span className="settings-label">
              Color Blind Mode
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#8888AA', marginTop: '2px' }}>
                Uses blue and orange instead of black and red for suits
              </span>
            </span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.colorBlindMode}
                onChange={(e) => update('colorBlindMode', e.target.checked)}
              />
              <span className="settings-toggle-track" />
              <span className="settings-toggle-knob" />
            </label>
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
            <span className="settings-label">Table felt color</span>
            <div className="settings-felt-preview">
              {FELT_COLORS.map((fc) => (
                <div
                  key={fc.color}
                  className={`settings-felt-swatch${settings.feltColor === fc.color ? ' active' : ''}`}
                  style={{
                    background: `linear-gradient(135deg, ${fc.color}, ${adjustBrightness(fc.color, -30)})`,
                  }}
                  onClick={() => update('feltColor', fc.color)}
                  title={fc.label}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Simple hex color brightness adjuster
function adjustBrightness(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
