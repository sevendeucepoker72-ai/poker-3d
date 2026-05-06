import { useState, useEffect, useRef } from 'react';
import useReducedMotion from '../../hooks/useReducedMotion';
import './WinConfetti.css';

const CONFETTI_COLORS = [
  '#FFD700', '#FF6B6B', '#4ADE80', '#60A5FA', '#F59E0B',
  '#A855F7', '#EC4899', '#FF8C00', '#00CED1', '#FFFFFF',
];

function generatePieces(count) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 150 + Math.random() * 350;
    const xSpread = Math.cos(angle) * speed * 0.4;
    const yLaunch = -100 - Math.random() * 200;
    const xEnd = Math.cos(angle) * speed;
    const yEnd = 200 + Math.random() * 400;
    const rotation = 360 + Math.random() * 720;

    pieces.push({
      id: i,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      style: {
        '--x-spread': `${xSpread}px`,
        '--y-launch': `${yLaunch}px`,
        '--x-end': `${xEnd}px`,
        '--y-end': `${yEnd}px`,
        '--rotation': `${rotation}deg`,
        animationDelay: `${Math.random() * 0.3}s`,
        animationDuration: `${2.5 + Math.random() * 1}s`,
        backgroundColor: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      },
    });
  }
  return pieces;
}

export default function WinConfetti({ chipsWon, disabled }) {
  const prefersReducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [pieces] = useState(() => generatePieces(50));
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, 3200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Accessibility: skip the flood of animated particles for users who
  // opted into reduced motion (vestibular / photosensitivity concerns) or
  // when the caller explicitly disables the effect. Screen readers still
  // pick up the "BIG WIN" announcement through the chip-award toast
  // elsewhere in GameHUD, so we aren't dropping information — only the
  // decorative particle animation. Render null so the component is also
  // a no-op for `display: none` / layout purposes.
  if (disabled || prefersReducedMotion) return null;
  if (!visible) return null;

  return (
    <>
      <div className="confetti-container">
        {pieces.map((piece) => (
          <div
            key={piece.id}
            className="confetti-piece"
            style={piece.style}
          />
        ))}
      </div>
      <div className="confetti-text">
        BIG WIN! +{(chipsWon ?? 0).toLocaleString()}
      </div>
    </>
  );
}
