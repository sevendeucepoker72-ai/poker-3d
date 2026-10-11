import { useState } from 'react';
import { createPortal } from 'react-dom';
import './Tutorial.css';

// 2026-10-11 (.online R2 — APPUI-35). The tour shows once per DEVICE: its
// "done" mark is in localStorage (it was sessionStorage, so it came back on
// every launch of the installed app). Copy matches the game: hole cards are
// face up (no hover to peek), and there is no "time bank" — when the clock
// runs out the hand is checked or folded for you.

const STORAGE_KEY = 'app_poker_tutorial_complete';

function readDone() {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return true;
    // A mark from an older build (this tab only) still counts.
    if (sessionStorage.getItem(STORAGE_KEY)) return true;
  } catch { /* storage blocked: show the tour */ }
  return false;
}

const steps = [
  {
    icon: '♠',
    title: 'Welcome to American Pub Poker!',
    description: 'Free-to-play poker with play-money chips. Let us show you around!',
  },
  {
    icon: '⚡',
    title: 'Quick Play',
    description: 'Tap Quick Play to jump into a game instantly.',
  },
  {
    icon: '🃏',
    title: 'Your Cards',
    description: 'Your cards are shown face up at the bottom of the screen — only you can see them.',
  },
  {
    icon: '🎯',
    title: 'Actions',
    description: 'When it is your turn: Fold, Check, Call, Raise or All-In.',
  },
  {
    icon: '⏱',
    title: 'Timer',
    description: 'A clock runs around your seat on your turn. If it runs out, your hand is checked or folded for you.',
  },
  {
    icon: '📚',
    title: 'Features',
    description: 'Explore the tabs: Play, Social, Profile and Shop. Level up, finish daily missions and earn achievements.',
  },
  {
    icon: '🌟',
    title: 'Good luck!',
    description: 'You are ready to play. Have fun at the tables!',
  },
];

export default function Tutorial() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(() => !readDone());

  const complete = () => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* ignore */ }
    setVisible(false);
  };

  const next = () => {
    if (step >= steps.length - 1) {
      complete();
    } else {
      setStep(step + 1);
    }
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  if (!visible) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return createPortal(
    <div className="tutorial-overlay">
      <div className="tutorial-panel" role="dialog" aria-label="Tutorial">
        <span className="tutorial-step-counter">{step + 1}/{steps.length}</span>
        <span className="tutorial-icon">{current.icon}</span>
        <div className="tutorial-title">{current.title}</div>
        <div className="tutorial-description">{current.description}</div>

        <div className="tutorial-actions">
          {step > 0 && (
            <button className="tutorial-btn-back" onClick={back}>Back</button>
          )}
          <button className="tutorial-btn-next" onClick={next}>
            {isLast ? "Let's Play!" : 'Next'}
          </button>
        </div>

        <div className="tutorial-dots">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`tutorial-dot${i === step ? ' active' : ''}${i < step ? ' completed' : ''}`}
            />
          ))}
        </div>

        <button className="tutorial-skip" onClick={complete}>Skip Tutorial</button>
      </div>
    </div>,
    document.body
  );
}
