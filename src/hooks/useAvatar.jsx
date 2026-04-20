import { useState, useEffect } from 'react';
import { getAvatarUrl, preloadAvatar } from '../utils/avatarService';

/**
 * React hook that returns the avatar URL for a player.
 * Auto-fetches from master API if not cached.
 * Returns { url: string|null, loading: boolean }
 */
export function useAvatar(playerId) {
  const [url, setUrl] = useState(() => getAvatarUrl(playerId));
  const [loading, setLoading] = useState(!url && !!playerId);

  useEffect(() => {
    if (!playerId) { setUrl(null); setLoading(false); return; }

    const cached = getAvatarUrl(playerId);
    if (cached !== null) {
      setUrl(cached || null);
      setLoading(false);
      return;
    }

    setLoading(true);
    preloadAvatar(playerId).then(result => {
      setUrl(result || null);
      setLoading(false);
    });
  }, [playerId]);

  return { url, loading };
}

/**
 * Avatar component — renders an img with fallback to initials.
 */
export function PlayerAvatar({ playerId, name, size = 40, style = {} }) {
  const { url } = useAvatar(playerId);
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
