// APP Precision (2026-11-24), package 2: a seat's round avatar in the skin.
// The same sources as the plain table, in the same order: the seat's photo,
// else the account's uploaded avatar, else its picked emoji, else a monogram
// (the name's first letter). Next to a photo a small letter badge names the
// player (the mockup's V / M / J); a monogram already is the letter.
// Only rendered when the build switch is on (PokerTable2D gates it).
import { useState } from 'react';
import { useAvatar } from '../../hooks/useAvatar';
import { nameInitial } from '../../utils/tablePayload';

// the auto-assigned chip presets are not a picked avatar (PlayerAvatar's rule)
const DEFAULT_CHIP_EMOJIS = ['🔴', '🔵', '🟢', '⚫', '⚪', '🟡', '🟠', '🟣'];

// `letter` false: no letter badge (the hero's own seat: GameHUD draws him).
export default function AppSeatAvatar({ name, photo, className, style, letter = true }) {
  // a seat photo needs no lookup (PlayerAvatar is not drawn for it either)
  const { url, emoji } = useAvatar(photo ? null : name);
  const src = photo || url || null;
  const [brokenSrc, setBrokenSrc] = useState(null);
  const showPhoto = !!src && brokenSrc !== src;
  const initial = nameInitial(name);
  const pickedEmoji = !showPhoto && emoji && !DEFAULT_CHIP_EMOJIS.includes(emoji) ? emoji : null;
  return (
    <>
      <div className={className} style={style}>
        {showPhoto ? (
          <img key={src} src={src} alt={name} className="seat-pod__avatar-photo" onError={() => setBrokenSrc(src)} />
        ) : pickedEmoji ? (
          <span className="app-seat-emoji" aria-hidden="true">{pickedEmoji}</span>
        ) : (
          <span className="app-seat-mono" aria-hidden="true">{initial}</span>
        )}
      </div>
      {letter && showPhoto && initial && <span className="app-seat-letter" aria-hidden="true">{initial}</span>}
    </>
  );
}
