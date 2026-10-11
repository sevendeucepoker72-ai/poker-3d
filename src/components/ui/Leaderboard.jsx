import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import { SEASON_REWARDS, SEASON_BADGES } from '../../utils/economyCatalog';
import { nextDenverMonthStartMs, formatCountdown, denverParts, toEpochMs } from '../../utils/denverTime';
import './Leaderboard.css';

// 2026-10-11 (.online R2 — C9 / APPUI-17 / APPUI-50 / addendum).
// - Every period tab says what it ranks. The server ranks daily / weekly /
//   season by chips WON in that Denver window (C9); a row that carries no
//   `chipsWon` (an older server ranks by balance) is labelled as a balance.
// - "You" is the row the server flags `isYou` — never a name match.
// - Season: the server's ranking, `seasonEndsAt` countdown, and the rewards
//   that are really paid at month end (50k / 25k / 10k chips + a badge).
// - Season badges a player holds (row `badges`) are drawn next to the name.
// - A row with a `userId` opens that player's profile (onOpenProfile).

export const LEADERBOARD_TABS = [
  { key: 'alltime', label: 'All-Time', ranks: 'Chip balance — every player' },
  { key: 'weekly', label: 'Weekly', ranks: 'Chips won this week (Sunday–Saturday, Denver time)' },
  { key: 'daily', label: 'Daily', ranks: 'Chips won today (Denver time)' },
  { key: 'season', label: 'Season', ranks: 'Chips won this month — top 3 are paid at month end' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getRankDisplay(rank) {
  if (rank === 1) return <span className="rank-trophy">🥇</span>;
  if (rank === 2) return <span className="rank-trophy">🥈</span>;
  if (rank === 3) return <span className="rank-trophy">🥉</span>;
  return <span className="rank-number">{rank}</span>;
}

function getWinRateClass(rate) {
  if (rate >= 40) return 'win-rate win-rate-high';
  if (rate >= 25) return 'win-rate win-rate-mid';
  return 'win-rate win-rate-low';
}

/** The number a row is ranked by for a period, and what to call it. */
export function rowValue(period, entry) {
  const won = Number(entry && (entry.chipsWon ?? entry.won ?? entry.periodChipsWon));
  if (period !== 'alltime' && Number.isFinite(won)) return { value: won, label: 'Won' };
  return { value: Number(entry && entry.chips) || 0, label: 'Chips' };
}

export function BadgeIcons({ badges }) {
  const list = (Array.isArray(badges) ? badges : []).map((b) => (typeof b === 'string' ? b : b && b.id)).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <span className="lb-badges">
      {list.map((id) => {
        const def = SEASON_BADGES.find((b) => b.id === id);
        return <span key={id} className="lb-badge" title={def ? def.name : id}>{def ? def.icon : '🏅'}</span>;
      })}
    </span>
  );
}

export default function Leaderboard({ onClose, onOpenProfile }) {
  const [activeTab, setActiveTab] = useState('alltime');
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useBackButtonClose(true, onClose);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) { setLoading(false); return undefined; }
    setLoading(true);
    const handleData = (data) => {
      if (!data || data.period !== activeTab) return;
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setMeta({ seasonEndsAt: toEpochMs(data.seasonEndsAt), rankedBy: data.rankedBy || data.metric || null, seasonName: data.seasonName || null });
      setLoading(false);
    };
    socket.on('leaderboardData', handleData);
    socket.emit('getLeaderboard', { period: activeTab });
    return () => socket.off('leaderboardData', handleData);
  }, [activeTab]);

  const tab = LEADERBOARD_TABS.find((t) => t.key === activeTab);
  const valueLabel = entries.length > 0 ? rowValue(activeTab, entries[0]).label : (activeTab === 'alltime' ? 'Chips' : 'Won');
  const ranksText = activeTab !== 'alltime' && valueLabel === 'Chips'
    ? 'Chip balance of players active in this period'
    : tab.ranks;
  const currentPlayer = entries.find((e) => e && e.isYou === true);

  const season = useMemo(() => {
    const endsAt = meta.seasonEndsAt || nextDenverMonthStartMs(now);
    const p = denverParts(now);
    const name = meta.seasonName || `${MONTHS[p.m - 1]} ${p.y} Season`;
    const daysInMonth = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
    return { endsAt, name, pct: Math.min(100, Math.round(((p.d - 1 + p.hh / 24) / daysInMonth) * 100)) };
  }, [meta.seasonEndsAt, meta.seasonName, now]);

  return createPortal(
    <div className="leaderboard-overlay" onClick={onClose}>
      <div className="leaderboard-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Leaderboard">
        <div className="leaderboard-header">
          <div className="leaderboard-title">Leaderboard</div>
          <button className="leaderboard-close" onClick={onClose}>Close</button>
        </div>

        <div className="leaderboard-tabs" role="tablist">
          {LEADERBOARD_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              className={`leaderboard-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="leaderboard-ranks-by">Ranked by: {ranksText}</div>

        {activeTab === 'season' && (
          <div className="season-info-section">
            <div className="season-header-row">
              <span className="season-name">{season.name}</span>
              <span className="season-days-left">Ends in {formatCountdown(season.endsAt, now)}</span>
            </div>
            <div className="season-progress-bar-track">
              <div className="season-progress-bar-fill" style={{ width: `${season.pct}%` }} />
            </div>
            <div className="season-rewards-box">
              <div className="season-rewards-title">Paid automatically when the month ends (Denver time)</div>
              <div className="season-rewards-list">
                {SEASON_REWARDS.map((r) => {
                  const badge = SEASON_BADGES.find((b) => b.id === r.badge);
                  return (
                    <div key={r.place} className="season-reward-item" style={{ borderLeftColor: badge ? badge.color : '#ffd24a' }}>
                      <span className="season-reward-place" style={{ color: badge ? badge.color : '#ffd24a' }}>{badge ? badge.icon : ''} #{r.place}</span>
                      <span className="season-reward-detail">{r.chips.toLocaleString()} chips + {badge ? badge.name : 'season'} badge</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="leaderboard-empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="leaderboard-empty">No ranked players yet — play some hands!</div>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th style={{ textAlign: 'right' }}>{valueLabel}</th>
                <th style={{ textAlign: 'right' }} className="lb-col-hands">Hands</th>
                <th style={{ textAlign: 'right' }}>Win %</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const rank = Number(entry.rank) || i + 1;
                const you = entry.isYou === true;
                const name = String(entry.displayName ?? entry.username ?? 'Player');
                const canOpen = typeof onOpenProfile === 'function' && entry.userId != null;
                const cls = [rank === 1 ? 'leaderboard-row-gold' : rank === 2 ? 'leaderboard-row-silver' : rank === 3 ? 'leaderboard-row-bronze' : '', you ? 'leaderboard-row-current' : '', canOpen ? 'leaderboard-row-link' : ''].join(' ');
                return (
                  <tr
                    key={`${rank}-${name}-${i}`}
                    className={cls}
                    onClick={canOpen ? () => onOpenProfile({ userId: entry.userId, name }) : undefined}
                  >
                    <td className="rank-cell">{getRankDisplay(rank)}</td>
                    <td className={you ? 'player-name-current' : 'player-name'}>
                      {name}{you ? ' (you)' : ''}
                      <BadgeIcons badges={entry.badges} />
                    </td>
                    <td className="chips-won">{rowValue(activeTab, entry).value.toLocaleString()}</td>
                    <td className="hands-played lb-col-hands">{(Number(entry.handsPlayed) || 0).toLocaleString()}</td>
                    <td className={getWinRateClass(Number(entry.winRate) || 0)}>{Number(entry.winRate) || 0}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {currentPlayer && (
          <div className="leaderboard-summary">
            <span>Your Rank: <span className="your-rank">#{currentPlayer.rank}</span></span>
            <span>{rowValue(activeTab, currentPlayer).value.toLocaleString()} {valueLabel === 'Won' ? 'chips won' : 'chips'} · {Number(currentPlayer.winRate) || 0}% win rate</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
