import { useState } from 'react';
import { createPortal } from 'react-dom';
import './Tutorial.css';

const STORAGE_KEY = 'app_poker_tutorial_complete';

const steps = [
  {
    icon: '\u2660',
    title: 'Welcome to American Pub Poker!',
    description: 'The most advanced free online poker platform. Let us show you around!',
  },
  {
    icon: '\u26A1',
    title: 'Quick Play',
    description: 'Click Quick Play to jump into a game instantly. No waiting, no hassle.',
  },
  {
    icon: '\uD83C\uDCCF',
    title: 'Your Cards',
    description: 'You\'ll receive cards at the bottom of the screen. Hover to peek at them!',
  },
  {
    icon: '\uD83C\uDFAF',
    title: 'Actions',
    description: 'Fold, Check, Call, Raise, or go All-In when it\'s your turn. Use keyboard shortcuts for speed!',
  },
  {
    icon: '\u23F1',
    title: 'Timer',
    description: 'You have 30 seconds to act, plus a time bank reserve for tough decisions.',
  },
  {
    icon: '\uD83D\uDCDA',
    title: 'Features',
    description: 'Explore the tabs: Play, Social, Profile, and Shop. Level up, earn achievements, and customize your experience.',
  },
  {
    icon: '\uD83C\uDF1F',
    title: 'Good luck!',
    description: 'You\'re ready to play! Have fun at the tables.',
  },
];

export default function Tutorial() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  });

  const complete = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {}
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
      <div className="tutorial-panel">
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
