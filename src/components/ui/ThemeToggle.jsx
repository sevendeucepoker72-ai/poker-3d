import { useState, useEffect } from 'react';
import './ThemeToggle.css';

// 2026-10-11 (.online R2 — APPUI P3). Light / dark mode has its OWN key. It
// used to write 'dark' / 'light' into `app_poker_theme` — the key the table
// reads for its felt theme — so toggling the mode wiped the felt choice.
const STORAGE_KEY = 'app_poker_ui_mode';
const LEGACY_KEY = 'app_poker_theme'; // the table felt's key: never written here

function readMode() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
    // A value an older build left in the felt key: move it out once.
    const legacy = sessionStorage.getItem(LEGACY_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      sessionStorage.setItem(STORAGE_KEY, legacy);
      sessionStorage.removeItem(LEGACY_KEY);
      return legacy;
    }
  } catch { /* ignore */ }
  return 'dark';
}

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => readMode() !== 'light');

  useEffect(() => {
    try {
      if (isDark) {
        document.body.classList.remove('light-theme');
        sessionStorage.setItem(STORAGE_KEY, 'dark');
      } else {
        document.body.classList.add('light-theme');
        sessionStorage.setItem(STORAGE_KEY, 'light');
      }
    } catch { /* ignore */ }
  }, [isDark]);

  return (
    <div className="theme-toggle">
      <button
        className="theme-toggle-btn"
        onClick={() => setIsDark((prev) => !prev)}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <span className="theme-toggle-icon">
          {isDark ? '☀️' : '🌙'}
        </span>
      </button>
    </div>
  );
}
