import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './KeyboardShortcuts.css';

const shortcuts = [
  { key: 'F', label: 'Fold' },
  { key: 'Space', label: 'Check / Call' },
  { key: 'R', label: 'Raise' },
  { key: 'A', label: 'All-In' },
  { key: 'E', label: 'Emote Wheel' },
  { key: 'C', label: 'Chat' },
  { key: '?', label: 'This Help' },
  { key: 'Esc', label: 'Close' },
  { key: '1', label: 'Bet Size 1' },
  { key: '2', label: 'Bet Size 2' },
  { key: '3', label: 'Bet Size 3' },
];

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        // Don't trigger if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="kb-overlay" onClick={() => setOpen(false)}>
      <div className="kb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="kb-header">
          <span className="kb-title">Keyboard Shortcuts</span>
          <button className="kb-close" onClick={() => setOpen(false)}>ESC</button>
        </div>
        <div className="kb-grid">
          {shortcuts.map((s, i) => (
            <div className="kb-row" key={i}>
              <span className="kb-key">{s.key}</span>
              <span className="kb-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
