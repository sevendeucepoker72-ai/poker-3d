import { useState, useEffect } from 'react';
import { getAvatarInfo, preloadAvatar } from '../utils/avatarService';

/**
 * React hook that returns the unified avatar info for a player.
 * Auto-fetches from master API (/avatars/display/:id) if not cached.
 *
 * 2026-05-29 audit P1-4: returns { info, loading } now — info carries
 * the full { type, url, emoji, presetId, frameId } shape so callers
 * can render emoji presets too, not just uploaded photos. Backward-
 * compat: `url` is still exposed as a top-level field.
 */
export function useAvatar(playerId) {
  const [info, setInfo] = useState(() => getAvatarInfo(playerId));
  const [loading, setLoading] = useState(!info && !!playerId);

  useEffect(() => {
    if (!playerId) { setInfo(null); setLoading(false); return; }

    const cached = getAvatarInfo(playerId);
    if (cached) {
      setInfo(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    preloadAvatar(playerId).then(result => {
      setInfo(result || null);
      setLoading(false);
    });
  }, [playerId]);

  return { info, url: info?.url || null, emoji: info?.emoji || null, loading };
}

/**
 * Avatar component — renders, in order of preference:
 *   1. Uploaded photo (img) when info.type='upload'
 *   2. Preset emoji span when info.type='preset' (incl. chip-* defaults)
 *   3. Initials + deterministic color when neither is present
 *
 * 2026-05-29 audit P1-4: previously only path #1 + #3 existed, so users
 * with the default chip-red preset (i.e. most users) rendered initials.
 * Now the chip emojis show in 3D nameplates too, matching player-web
 * and admin kiosk behavior.
 */
export function PlayerAvatar({ playerId, name, size = 40, style = {} }) {
  const { url, emoji } = useAvatar(playerId);
  const initial = (name || '?')[0].toUpperCase();

  // Generate consistent color from name
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = ((hash << 5) - hash) + (name || '').charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue}, 55%, 45%)`;

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', ...style,
        }}
        onError={(e) => { e.target.style.display = 'none'; }}
      />
    );
  }

  if (emoji) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.6, lineHeight: 1,
        ...style,
      }}>
        {emoji}
      </div>
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${bg}, hsl(${(hue + 40) % 360}, 55%, 35%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.45,
      ...style,
    }}>
      {initial}
    </div>
  );
}
