/**
 * RankBadge — renders a coloured tier badge for a given rank string
 * or ELO number. Used in the Profile tab, leaderboard, and nameplates.
 */

export const RANK_TIERS = [
  { name: 'Champion',    min: 2000, color: '#FFD700', bg: 'rgba(255,215,0,0.15)',   icon: '👑' },
  { name: 'Diamond III', min: 1800, color: '#60D4FF', bg: 'rgba(96,212,255,0.12)',  icon: '💎' },
  { name: 'Diamond II',  min: 1700, color: '#60D4FF', bg: 'rgba(96,212,255,0.12)',  icon: '💎' },
  { name: 'Diamond I',   min: 1500, color: '#60D4FF', bg: 'rgba(96,212,255,0.12)',  icon: '💎' },
  { name: 'Platinum III',min: 1400, color: '#A8FFD8', bg: 'rgba(168,255,216,0.1)',  icon: '⚡' },
  { name: 'Platinum II', min: 1300, color: '#A8FFD8', bg: 'rgba(168,255,216,0.1)',  icon: '⚡' },
  { name: 'Platinum I',  min: 1000, color: '#A8FFD8', bg: 'rgba(168,255,216,0.1)',  icon: '⚡' },
  { name: 'Gold III',    min:  900, color: '#FFC940', bg: 'rgba(255,201,64,0.12)',  icon: '🥇' },
  { name: 'Gold II',     min:  800, color: '#FFC940', bg: 'rgba(255,201,64,0.12)',  icon: '🥇' },
  { name: 'Gold I',      min:  600, color: '#FFC940', bg: 'rgba(255,201,64,0.12)',  icon: '🥇' },
  { name: 'Silver III',  min:  500, color: '#C0C8D8', bg: 'rgba(192,200,216,0.1)', icon: '🥈' },
  { name: 'Silver II',   min:  400, color: '#C0C8D8', bg: 'rgba(192,200,216,0.1)', icon: '🥈' },
  { name: 'Silver I',    min:  300, color: '#C0C8D8', bg: 'rgba(192,200,216,0.1)', icon: '🥈' },
  { name: 'Bronze III',  min:  200, color: '#CD7F32', bg: 'rgba(205,127,50,0.12)', icon: '🥉' },
  { name: 'Bronze II',   min:  100, color: '#CD7F32', bg: 'rgba(205,127,50,0.12)', icon: '🥉' },
  { name: 'Bronze I',    min:    0, color: '#CD7F32', bg: 'rgba(205,127,50,0.12)', icon: '🥉' },
];

export function getRankInfo(rankNameOrElo) {
  if (typeof rankNameOrElo === 'number') {
    for (const tier of RANK_TIERS) {
      if (rankNameOrElo >= tier.min) return tier;
    }
    return RANK_TIERS[RANK_TIERS.length - 1];
  }
  return RANK_TIERS.find((t) => t.name === rankNameOrElo) ?? RANK_TIERS[RANK_TIERS.length - 1];
}

export function getNextRankInfo(rankName) {
  const idx = RANK_TIERS.findIndex((t) => t.name === rankName);
  return idx > 0 ? RANK_TIERS[idx - 1] : null;
}

/** Small inline badge (used on nameplates / leaderboard rows) */
export default function RankBadge({ rank, elo, size = 'sm' }) {
  const info = getRankInfo(rank ?? elo ?? 0);
  const isLarge = size === 'lg';

  return (
    <span
      title={`${info.name} · ${elo ?? ''} ELO`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isLarge ? '6px' : '3px',
        padding: isLarge ? '4px 10px' : '2px 6px',
        background: info.bg,
        border: `1px solid ${info.color}44`,
        borderRadius: isLarge ? '8px' : '4px',
        fontSize: isLarge ? '0.8rem' : '0.65rem',
        fontWeight: 700,
        color: info.color,
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: isLarge ? '1rem' : '0.75rem' }}>{info.icon}</span>
      {info.name}
    </span>
  );
}
