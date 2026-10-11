/**
 * Lifetime achievements as the SERVER defines them (2026-10-11, .online R2 —
 * APPUI-49).
 *
 * The lobby, StatsPanel and the profile wall each carried their own list with
 * ids the server never awards (high_roller / bluff_master / all_in_warrior /
 * social_butterfly, "50 chat messages") or thresholds it doesn't use, so real
 * unlocks showed as locked. This is a snapshot of poker-server
 * ProgressionManager ACHIEVEMENTS (ids, names, descriptions); screens prefer
 * the live `achievementsList` answer (getAchievements) when they have it.
 */

export const LIFETIME_ACHIEVEMENTS = [
  { id: 'first_win', name: 'First Blood', description: 'Win your first hand' },
  { id: 'hands_100', name: 'Card Shark', description: 'Play 100 hands' },
  { id: 'hands_500', name: 'Regular', description: 'Play 500 hands' },
  { id: 'hands_1000', name: 'Veteran', description: 'Play 1,000 hands' },
  { id: 'hands_5000', name: 'Road Warrior', description: 'Play 5,000 hands' },
  { id: 'hands_10000', name: 'Poker Lifer', description: 'Play 10,000 hands' },
  { id: 'hands_50000', name: 'Grinder', description: 'Play 50,000 hands' },
  { id: 'hands_100000', name: 'Iron Player', description: 'Play 100,000 hands' },
  { id: 'wins_50', name: 'Solid Winner', description: 'Win 50 hands' },
  { id: 'wins_250', name: 'Winning Player', description: 'Win 250 hands' },
  { id: 'wins_1000', name: 'Crusher', description: 'Win 1,000 hands' },
  { id: 'wins_5000', name: 'Dominator', description: 'Win 5,000 hands' },
  { id: 'pot_10k', name: 'Nice Score', description: 'Win a pot of 10,000+' },
  { id: 'pot_50k', name: 'High Roller', description: 'Win a pot of 50,000+' },
  { id: 'pot_200k', name: 'Whale Slayer', description: 'Win a pot of 200,000+' },
  { id: 'pot_1m', name: 'Millionaire Pot', description: 'Win a pot of 1,000,000+' },
  { id: 'streak_5', name: 'Hot Streak', description: 'Win 5 hands in a row' },
  { id: 'streak_10', name: 'Unstoppable', description: 'Win 10 hands in a row' },
  { id: 'streak_20', name: 'Heater', description: 'Win 20 hands in a row' },
  { id: 'full_house', name: 'Full House', description: 'Make a full house' },
  { id: 'quads', name: 'Four of a Kind', description: 'Make four of a kind' },
  { id: 'straight_flush', name: 'Straight Flush', description: 'Make a straight flush' },
  { id: 'royal_flush', name: 'Royal Flush!', description: 'Make a Royal Flush' },
  { id: 'bluff_10', name: 'Bluff Master', description: 'Win 10 hands by bluffing' },
  { id: 'bluff_50', name: 'Con Artist', description: 'Win 50 hands by bluffing' },
  { id: 'allin_20', name: 'All-In Warrior', description: 'Win 20 hands all-in' },
  { id: 'allin_100', name: 'No Fear', description: 'Win 100 hands all-in' },
  { id: 'tourney_win_1', name: 'Champion', description: 'Win a tournament' },
  { id: 'tourney_win_10', name: 'Tour Grinder', description: 'Win 10 tournaments' },
  { id: 'tourney_enter_50', name: 'Regular Entry', description: 'Enter 50 tournaments' },
  { id: 'all_variants', name: 'Game Master', description: 'Play every poker variant at least once' },
  { id: 'social_10', name: 'Chatty', description: 'Send 10 chat messages' },
  { id: 'social_100', name: 'Social Butterfly', description: 'Send 100 chat messages' },
  { id: 'lvl_25', name: 'Silver Reached', description: 'Reach level 25' },
  { id: 'lvl_75', name: 'Gold Reached', description: 'Reach level 75' },
  { id: 'lvl_150', name: 'Diamond Reached', description: 'Reach level 150' },
  { id: 'lvl_300', name: 'Platinum Reached', description: 'Reach level 300' },
  { id: 'lvl_500', name: 'Master Reached', description: 'Reach level 500' },
  { id: 'lvl_700', name: 'Legendary Reached', description: 'Reach level 700' },
  { id: 'lvl_1000', name: 'The Ceiling', description: 'Reach level 1000 (max)' },
];

/** An icon for an achievement id (the server catalog has none). */
export function achievementIcon(id) {
  const s = String(id || '');
  if (s.startsWith('royal')) return '👑';
  if (s.startsWith('straight_flush')) return '🌊';
  if (s.startsWith('quads')) return '🎴';
  if (s.startsWith('full_house')) return '🏠';
  if (s.startsWith('streak')) return '⚡';
  if (s.startsWith('hands')) return '🎖';
  if (s.startsWith('wins')) return '🏅';
  if (s.startsWith('pot')) return '💰';
  if (s.startsWith('bluff')) return '🎭';
  if (s.startsWith('allin')) return '🔥';
  if (s.startsWith('tourney')) return '🏆';
  if (s.startsWith('lvl')) return '⭐';
  if (s.startsWith('social')) return '💬';
  if (s === 'all_variants') return '🎲';
  if (s === 'first_win') return '🎯';
  return '🏅';
}

/**
 * The achievement rows to show: the live server list when there is one
 * (`achievementsList.lifetime`: {id,name,description,reward,unlocked}), else
 * the snapshot with `unlocked` from the ids the server sent in
 * playerProgress.achievements.
 */
export function lifetimeAchievementRows(liveLifetime, unlockedIds) {
  const unlocked = new Set(Array.isArray(unlockedIds) ? unlockedIds.map(String) : []);
  if (Array.isArray(liveLifetime) && liveLifetime.length > 0) {
    return liveLifetime
      .filter((a) => a && typeof a.id === 'string')
      .map((a) => ({
        id: a.id,
        name: String(a.name || a.id),
        description: String(a.description || ''),
        reward: a.reward || null,
        unlocked: !!a.unlocked || unlocked.has(a.id),
        icon: achievementIcon(a.id),
      }));
  }
  return LIFETIME_ACHIEVEMENTS.map((a) => ({ ...a, reward: null, unlocked: unlocked.has(a.id), icon: achievementIcon(a.id) }));
}

/** Unlocked first (most recent server order kept), then locked. */
export function sortAchievementRows(rows) {
  return [...rows.filter((r) => r.unlocked), ...rows.filter((r) => !r.unlocked)];
}
