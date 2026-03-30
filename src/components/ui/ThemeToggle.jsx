import { useState, useEffect } from 'react';
import './ThemeToggle.css';

const STORAGE_KEY = 'app_poker_theme';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'light';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (isDark) {
      document.body.classList.remove('light-theme');
      localStorage.setItem(STORAGE_KEY, 'dark');
    } else {
      document.body.classList.add('light-theme');
      localStorage.setItem(STORAGE_KEY, 'light');
    }
  }, [isDark]);

  // Apply on mount in case of stored preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light') {
        document.body.classList.add('light-theme');
        setIsDark(false);
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="theme-toggle">
      <button
        className="theme-toggle-btn"
        onClick={() => setIsDark((prev) => !prev)}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <span className="theme-toggle-icon">
          {isDark ? '\u2600\uFE0F' : '\uD83C\uDF19'}
        </span>
      </button>
    </div>
  );
}
