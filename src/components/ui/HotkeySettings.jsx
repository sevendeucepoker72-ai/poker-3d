import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './HotkeySettings.css';

const DEFAULT_HOTKEYS = {
  fold: 'f',
  checkCall: ' ',
  raise: 'r',
  allIn: 'a',
  emote: 'e',
  chat: 'c',
};

const ACTION_LABELS = {
  fold: 'Fold',
  checkCall: 'Check / Call',
  raise: 'Raise',
  allIn: 'All-In',
  emote: 'Emote Wheel',
  chat: 'Chat',
};

function getKeyDisplay(key) {
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (key === 'ArrowUp') return 'Up';
  if (key === 'ArrowDown') return 'Down';
  if (key === 'ArrowLeft') return 'Left';
  if (key === 'ArrowRight') return 'Right';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function loadHotkeys() {
  try {
    const stored = localStorage.getItem('app_poker_hotkeys');
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_HOTKEYS, ...parsed };
    }
  } catch (e) {
    // ignore
  }
  return { ...DEFAULT_HOTKEYS };
}

export function saveHotkeys(hotkeys) {
  localStorage.setItem('app_poker_hotkeys', JSON.stringify(hotkeys));
}

export default function HotkeySettings({ open, onClose }) {
  const [hotkeys, setHotkeys] = useState(loadHotkeys);
  const [listening, setListening] = useState(null); // action key being rebound

  // Listen for keypress when rebinding
  useEffect(() => {
    if (!listening) return;

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels rebinding
      if (e.key === 'Escape') {
        setListening(null);
        return;
      }

      const newKey = e.key;
      const updated = { ...hotkeys, [listening]: newKey };
      setHotkeys(updated);
      saveHotkeys(updated);
      setListening(null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [listening, hotkeys]);

  const handleReset = useCallback(() => {
    setHotkeys({ ...DEFAULT_HOTKEYS });
    saveHotkeys(DEFAULT_HOTKEYS);
    setListening(null);
  }, []);

  if (!open) return null;

  return createPortal(
    <div className="hotkey-overlay" onClick={onClose}>
      <div className="hotkey-panel" onClick={(e) => e.stopPropagation()}>
        <div className="hotkey-title">Hotkey Settings</div>

        <div className="hotkey-list">
          {Object.entries(ACTION_LABELS).map(([action, label]) => (
            <div
              key={action}
              className={`hotkey-row ${listening === action ? 'hotkey-listening' : ''}`}
            >
              <span className="hotkey-action-name">{label}</span>
              <button
                className={`hotkey-key-btn ${listening === action ? 'hotkey-key-listening' : ''}`}
                onClick={() => setListening(listening === action ? null : action)}
              >
                {listening === action ? 'Press key...' : getKeyDisplay(hotkeys[action])}
              </button>
            </div>
          ))}
        </div>

        <div className="hotkey-hint">
          Click a key binding, then press the new key. Press Escape to cancel.
        </div>

        <div className="hotkey-footer">
          <button className="hotkey-reset-btn" onClick={handleReset}>
            Reset Defaults
          </button>
          <button className="hotkey-close-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
