// Weekly Qualifier Rules - the text players read on americanpubpoker.online
// (owner 2026-10-23). Shown by components/ui/QualifierRules.jsx: the "Rules"
// link on the weekly qualifier card (home card + Play tab) and the "Rules" tab
// of the qualifier's detail window.
//
// OWNER: to change the rules, edit the text in this file only, then bump
// QUALIFIER_RULES_UPDATED. Each section is { heading, rules: [one rule per
// entry] }. `compact: true` draws that section's lines as a tight grid (the
// blind levels). Keep it plain: short sentences, "you", Mountain Time, no
// dashes as asides.
//
// A rule is a plain string, or an object { needs, text, otherwise }:
//   - `text` shows only when every key in `needs` is known for the qualifier
//     the player opened the rules from; otherwise `otherwise` shows (nothing
//     when there is no `otherwise`).
//   - `text` can use {top} (the last place that wins a seat), {bubble}
//     ({top} + 1) and {seatPackage} (this qualifier's seat package in words).
// The keys (qualifierRulesContext):
//   top, bubble           the qualifier says how many places win seats
//   seatPackage           it has a seat package
//   noSeatPackage         it says how many places win seats and has no package
//   lateRegClosesAtBubble poker-server says late entry / re-entry close at the
//                         seat bubble (flag on the qualifier; absent = they
//                         close at 2:00 PM MT only, which is today's server)
//   seedsHeldUntilEnd     poker-server says it keeps a running qualifier's
//                         seeds private until it ends (flag; absent = each
//                         hand's seed can be read as soon as that hand ends,
//                         which is today's server)
// So the week's seat package and bubble come from the qualifier itself, and a
// rule that needs a server change shows only once that server says it does it.
// Never write a rule here that the code does not do.

export const QUALIFIER_RULES_TITLE = 'Weekly Qualifier Rules';

/** The line under the title of the rules window. */
export const QUALIFIER_RULES_SUBTITLE = 'Every Sunday at 11:00 AM MT on americanpubpoker.online';

/** The day these rules were last changed (YYYY-MM-DD, shown as "Updated Oct 23, 2026."). */
export const QUALIFIER_RULES_UPDATED = '2026-10-23';

export const QUALIFIER_RULES = [
  {
    heading: 'About the qualifier',
    rules: [
      'The qualifier is free. Chips have no cash value. Prizes are seats to the live championship only.',
      "The Weekly Qualifier is an online tournament on americanpubpoker.online. The top finishers win seats to the Bar Poker Championship at Bally's Blackhawk.",
      'All times are Mountain Time (MT).',
    ],
  },
  {
    heading: 'Who can play',
    rules: [
      'You need an American Pub Poker account. Sign in with it on americanpubpoker.online to enter and play.',
      'You earn one weekly qualifier credit each time you finish in the top 5 of an American Pub Poker live game. If first place is chopped, everyone in the chop counts as 1st.',
      "The credit is added when staff finish entering that game's results. Console-league games give a different credit that does not work for this event.",
      'Each entry uses one credit. Your oldest unused credit is used first. There is no chip buy-in.',
      'Credits are good through the end of the 2026-27 season (March 2027).',
      'You get your credit back if you withdraw before the tables open, if you are released for not being online at the start, if no seat can be found for you, or if the qualifier is cancelled.',
      'One person, one account. You can be in the qualifier only once at a time, on your own account.',
      'If you are suspended, you cannot enter. If you are suspended during the qualifier, you are removed within a hand or two and get no place, seat or monthly credit.',
    ],
  },
  {
    heading: 'Schedule',
    rules: [
      'The Weekly Qualifier is every Sunday at 11:00 AM MT.',
      'Sign-up opens at 8:00 AM MT. Tap Register on the qualifier card at americanpubpoker.online.',
      'You can withdraw on the qualifier card until the tables open. Your credit comes back.',
      'The tables open at 10:50 AM MT, or as soon after that as two registered players are online. If you are online, you are seated and taken to your table. If you come online later, you are seated when you arrive. No cards are dealt yet.',
      'Cards are dealt and level 1 starts at exactly 11:00 AM MT.',
      'After the start you can still join by late entry. A late entry gets 50,000 chips and a seat right away, and uses one credit.',
      {
        needs: ['lateRegClosesAtBubble'],
        text: 'Late entry and re-entry close at 2:00 PM MT, or as soon as the seat bubble is reached, whichever comes first.',
        otherwise: 'Late entry and re-entry close at 2:00 PM MT. They stay open until then, even if only a few players are left.',
      },
      {
        needs: ['lateRegClosesAtBubble', 'bubble'],
        text: 'For this qualifier, the seat bubble is reached when {bubble} players are left.',
      },
      'If the start has to wait for players, level 1 and every break start later. Late entry still closes by 2:00 PM MT.',
      'Leave any other americanpubpoker.online table first. You cannot late-register or re-enter while you are seated somewhere else.',
      'If you are seated somewhere else at 11:00, your qualifier seat is dealt in without you until you leave that table and tap Go to my table.',
    ],
  },
  {
    heading: 'Re-entries',
    rules: [
      'If you bust before late entry closes, you can re-enter. Tap Re-enter on the qualifier card.',
      'Each re-entry uses one credit. There is no other limit. You can re-enter as long as you have credits.',
      'A re-entry gets a fresh 50,000 chips, the same as the start. You can only re-enter after you bust. There are no add-ons.',
      'Re-entry closes at the same time as late entry.',
      'Only your last entry counts. When you re-enter, your earlier finish is erased. You get one finish place at the end.',
    ],
  },
  {
    heading: 'Absent at the start',
    rules: [
      'Be signed in on americanpubpoker.online at 11:00 AM MT. Any page of the site counts, and so does being seen in the 2 minutes before the deal.',
      'If you are not online when the cards are dealt, you are released. Your seat is removed and your credit is returned.',
      'If you sign in within 24 hours, you see a notice that the qualifier started without you.',
      'You can still come back by late entry until late entry closes. It uses a credit, like any entry. If no seat can be found, the credit comes back.',
      'If fewer than two registered players are online at 11:00, nobody is released and the start waits. If two are not online by 2:00 PM MT, the qualifier is cancelled and every credit is returned.',
    ],
  },
  {
    heading: 'Structure',
    rules: [
      'Everyone starts with 50,000 chips. Late entries and re-entries also get 50,000.',
      'Levels are 12 minutes long. There are 26 levels. The blinds and antes for each level are listed below.',
      'Every player dealt into a hand pays the ante.',
      'Level 26 is the last level. Its blinds do not go up again.',
      'There is a 5-minute break after every 5th level. With no pauses, breaks start at about 12:00, 1:05, 2:10, 3:15 and 4:20 PM MT.',
      'A hand already in progress finishes first, and that time counts toward the break.',
      'The blind clock stops during a break. After a director pause, the level picks up with the time it had left.',
      'Play goes on until one player has all the chips. Plan on 4 to 6 hours.',
      'If only one player is left before late entry closes, the qualifier ends right then. Late entry and re-entry end with it.',
    ],
  },
  {
    heading: 'Blinds and antes',
    compact: true,
    rules: [
      'Level 1: 25/50',
      'Level 2: 50/100',
      'Level 3: 75/150, ante 25',
      'Level 4: 100/200, ante 25',
      'Level 5: 150/300, ante 50',
      'Level 6: 200/400, ante 50',
      'Level 7: 300/600, ante 75',
      'Level 8: 400/800, ante 100',
      'Level 9: 500/1,000, ante 100',
      'Level 10: 600/1,200, ante 200',
      'Level 11: 800/1,600, ante 200',
      'Level 12: 1,000/2,000, ante 300',
      'Level 13: 1,500/3,000, ante 500',
      'Level 14: 2,000/4,000, ante 500',
      'Level 15: 3,000/6,000, ante 1,000',
      'Level 16: 4,000/8,000, ante 1,000',
      'Level 17: 5,000/10,000, ante 1,500',
      'Level 18: 6,000/12,000, ante 2,000',
      'Level 19: 8,000/16,000, ante 2,000',
      'Level 20: 10,000/20,000, ante 3,000',
      'Level 21: 15,000/30,000, ante 5,000',
      'Level 22: 20,000/40,000, ante 5,000',
      'Level 23: 30,000/60,000, ante 10,000',
      'Level 24: 50,000/100,000, ante 10,000',
      'Level 25: 75,000/150,000, ante 25,000',
      'Level 26: 100,000/200,000, ante 25,000',
    ],
  },
  {
    heading: 'Seating',
    rules: [
      'Starting seats are drawn at random by the computer.',
      'Tables seat up to 9 players. At the start, the tables are within one player of each other.',
      'Late entries and re-entries are seated at the table with the fewest players that has room.',
      'If your new seat is between the button and the small blind, you sit out one hand before you are dealt in.',
      'Tables are kept even. After each hand at the fullest table (6 or more players), if another table has at least 2 fewer players, the player due the big blind next moves to the shortest table. The game takes you to your new seat.',
      'If every seat is full when someone late-registers or re-enters, a new table opens. A player alone there is not dealt in and pays no blinds. If that player is at the table, one player moves over from the fullest table so play can start. There is no limit on extra tables.',
      'As players bust, tables are combined. A table closes when everyone fits at one fewer table, or when it drops below 5 players and the other tables have room. Its players move to open seats at the other tables. The final table seats up to 9.',
    ],
  },
  {
    heading: 'Bubble and ties',
    rules: [
      'The seat bubble is the point where one more player is left than there are seat places.',
      {
        needs: ['top'],
        text: 'For this qualifier, seats go to the top {top}, so the bubble is at {bubble} players.',
      },
      {
        needs: ['lateRegClosesAtBubble'],
        text: 'Once late entry has closed, when the seat bubble is reached and two or more tables are still playing, play goes hand-for-hand. Each table plays one hand, then waits until every other table has finished its hand. You see a message when it starts and when it ends.',
        otherwise: 'After late entry closes at 2:00 PM MT, when the field is at the seat bubble and two or more tables are still playing, play goes hand-for-hand. Each table plays one hand, then waits until every other table has finished its hand. You see a message when it starts and when it ends.',
      },
      {
        needs: ['lateRegClosesAtBubble'],
        otherwise: 'There is no hand-for-hand if fewer players than the bubble are left at 2:00 PM MT, or if two players bust in the same hand and the count skips past the bubble.',
      },
      'Hand-for-hand is used only when the bubble is 10 or more players. With 9 or fewer, everyone is moved to one table.',
      'Hand-for-hand ends when the bubble player busts or only one table is left. If a table stalls for too long, the game stops waiting and normal play resumes for the rest of the qualifier. The blind clock keeps running during hand-for-hand.',
      'If you bust during a hand-for-hand round, your place is shown after every table has finished that hand.',
      'If two or more players bust in the same hand at one table, the player who started that hand with more chips finishes higher.',
      'During hand-for-hand, players who bust in the same round at different tables are ranked the same way, by their chips at the start of that hand.',
      'Outside hand-for-hand, players who bust at different tables are placed in the order they are knocked out.',
      'If players bust in the same hand with exactly the same starting chips, the player in the lower-numbered seat finishes lower. Across tables, the player at the earlier table finishes lower (Table 1 before Table 2).',
      'Your place is set when you bust, but it can still move down until late entry closes. If a new player late-registers after you are out, you move down one place. If a player who went out before you re-enters, you also move down one place.',
    ],
  },
  {
    heading: 'Prizes',
    rules: [
      {
        needs: ['seatPackage'],
        text: "This qualifier's seat package: {seatPackage}",
      },
      {
        needs: ['noSeatPackage'],
        text: 'This qualifier has no seat package, so the top {top} win 1 seat each.',
      },
      "Each week's seat package is set by Friday and shown on the qualifier card. When no package is set, the top 3 win 1 seat each.",
      "With a seat package, if nobody finishes in a seat place, or the player in it is removed, that place's seats are not given out and nobody moves up. When no package is set, the next finishers move up instead.",
      'You can hold at most 10 championship seats for the 2026 championship, counting every way you earned them. Seats you have already used still count.',
      'Each seat is checked on its own. If a seat would put a finisher over 10, that seat passes to the next finisher below who has room. A player who won seats of their own takes a passed seat only if there is room for their own seats too. If nobody below has room, that seat is not given out.',
      'Players who already have 10 seats can still enter and play. Any seat they finish in passes down.',
      'If you win again in another week, you earn more seats, up to the 10-seat limit.',
      'The top 10% of finishers, rounded up (at least 1), each earn a monthly qualifier credit. This counts players, not entries.',
      "You can get only one monthly credit for each calendar month, counting league standings too. If you already have that month's credit, you do not get another.",
      'The monthly qualifier is the 3rd Saturday of each month at 11:00 AM MT. It needs a monthly credit.',
      'When the qualifier ends, the results are sent to American Pub Poker and your seats are added on their own.',
      'You get a "You won 1 championship seat!" (or "You won 3 championship seats!") notice in the American Pub Poker app at americanpub.poker. Your Player Hub there lists your seats and is the official record.',
      'The results screen on americanpubpoker.online shows seats by place. It does not show seats that were passed down, so check your Player Hub.',
      'The finish order is saved when the qualifier ends. If the results do not post on their own, staff enter them from the saved order.',
      "To use your seat at Bally's, bring a photo ID. The name on it must match the name on your American Pub Poker account.",
    ],
  },
  {
    heading: 'Disconnects and time to act',
    rules: [
      'You have 30 seconds to act each time. There is no time bank.',
      'If your time runs out, the game checks for you if it can. If not, it folds your hand. It never bets or raises for you.',
      'One exception: if everyone still in the hand is away, it may call one big blind before the flop so the hand can finish.',
      'If you lose your connection, your seat stays in the qualifier. You are still dealt in and still pay blinds and antes. There is no all-in protection.',
      'For your first 20 hands away, your turns still get the full 30 seconds. After that, your turns get 3 seconds.',
      'When you sign back in after a lost connection, you go straight back to your seat.',
      'If you leave the table on purpose or sit out, your seat keeps playing on a 3-second clock. To play again, tap Go to my table on the qualifier card, or sit back in.',
    ],
  },
  {
    heading: 'If something goes wrong',
    rules: [
      'We do not update the game server on Sundays from 7:45 AM MT until the results post.',
      'If the game server restarts after sign-up opens and before the qualifier ends, the qualifier is cancelled. Every credit it used, entries and re-entries, is returned. No seats or monthly credits come from it.',
      'If that happens before 2:00 PM MT, the qualifier opens for sign-up again, and you must register again with your returned credit. If the restart was before 11:00 AM, it starts on time as usual. If it was during play, it starts over from level 1 as soon as two registered players are online.',
      'If the qualifier opens again, we announce it right away by app notification and on Facebook.',
      'If a credit does not come back on its own, for example after a sudden server crash, staff return it by hand within 48 hours.',
      'The tournament director can pause the qualifier for everyone. When play resumes, the level picks up with the time it had left.',
      'To report a problem, message Support in the American Pub Poker app within 24 hours after the qualifier ends.',
      "The owner of American Pub Poker is the tournament director. The director decides disputes and anything these rules do not cover. The director's decision is final.",
    ],
  },
  {
    heading: 'Fair play',
    rules: [
      "Never play someone else's account, and never let anyone else play yours.",
      'Do not team up with other players. No sharing your cards, no soft play, and no losing chips to a friend on purpose (chip dumping).',
      'All help tools are off at qualifier tables. That means no GTO Solver, GTO Overlay, AI Coach, Pause & Coach, Equity Heatmap, Timing Tells, Range Chart, Equity Calc or Training.',
      "No hand strength bar, pot odds, outs or player stats are shown there. You still see the name of your hand, and each player's chance to win once hands are shown face up.",
      "While you play the qualifier, do not use any help tool, including this site's own tools in the lobby or at another table.",
      'Outside help is banned too. That means no solvers, charts, AI tools, real-time assistance programs, or another person telling you what to do.',
      'If you cheat or break these rules, you are removed from the qualifier with no place or seat. The seats and credits you won in that qualifier are taken back, and you may be suspended from all American Pub Poker games.',
      'Results and seats can be reviewed for fair play for 7 days after the qualifier.',
    ],
  },
  {
    heading: 'Fair shuffle',
    rules: [
      "Every shuffle is locked in before the hand is dealt. Before each hand, your table gets a fingerprint of that shuffle. You can see it in the table's Options menu, under Analysis Tools, then Provably Fair.",
      {
        needs: ['seedsHeldUntilEnd'],
        text: 'The shuffle codes (seeds) of a running qualifier stay private until it ends, so nobody can work out folded cards during play.',
      },
      {
        needs: ['seedsHeldUntilEnd'],
        text: "After the qualifier ends, each hand's shuffle code can be checked against the fingerprint shown before that hand. The server keeps the last 50 hands of each table for 7 days. Ask Support if you want a hand checked.",
        otherwise: 'After each hand, its shuffle code (seed) can be checked against the fingerprint shown before that hand. The server keeps the last 50 hands of each table for 7 days. Ask Support if you want a hand checked.',
      },
    ],
  },
];

// ---- Code below: not rule text (except the seat package words). ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-23" -> "Oct 23, 2026" (no browser locale / zone involved); '' when not a date. */
export function formatRulesUpdated(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return '';
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}

/** "Updated Oct 23, 2026." for the top of the rules; '' when the date is not a date. */
export function rulesUpdatedLine(iso = QUALIFIER_RULES_UPDATED) {
  const d = formatRulesUpdated(iso);
  return d ? `Updated ${d}.` : '';
}

/** These rules are the WEEKLY qualifier's: the card / detail window of a weekly event links to them. */
export function qualifierHasWeeklyRules(q) {
  return !!q && typeof q === 'object' && String(q.type ?? '').toLowerCase() === 'weekly';
}

function ordinalWord(n) {
  const m = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return n + (s[(m - 20) % 10] || s[m] || s[0]);
}

function seatWord(n) {
  return n === 1 ? '1 seat' : `${n} seats`;
}

/** A clean {place: seats} (whole places 1-100, 1-10 seats each), or null - the server's own limits. */
function cleanSeatPackage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(raw)) {
    const place = Number(k);
    const seats = Number(v);
    if (!Number.isInteger(place) || place < 1 || place > 100 || !Number.isInteger(seats) || seats < 1 || seats > 10) return null;
    out[place] = seats;
    total += seats;
  }
  return total > 0 ? out : null;
}

/**
 * A seat package in words: {1:3, 2:2, 3:2, 4:2, 5..10:1} ->
 * "1st wins 3 seats. 2nd, 3rd and 4th win 2 seats each. 5th through 10th win
 * 1 seat each. That is 15 seats." '' when it is not a package.
 */
export function seatPackageWords(raw) {
  const pkg = cleanSeatPackage(raw);
  if (!pkg) return '';
  const places = Object.keys(pkg).map(Number).sort((a, b) => a - b);
  const groups = [];
  for (const pl of places) {
    const g = groups[groups.length - 1];
    if (g && g.to === pl - 1 && g.n === pkg[pl]) g.to = pl;
    else groups.push({ from: pl, to: pl, n: pkg[pl] });
  }
  const parts = groups.map((g) => {
    const count = g.to - g.from + 1;
    if (count === 1) return `${ordinalWord(g.from)} wins ${seatWord(g.n)}.`;
    let who;
    if (count === 2) who = `${ordinalWord(g.from)} and ${ordinalWord(g.to)}`;
    else if (count === 3) who = `${ordinalWord(g.from)}, ${ordinalWord(g.from + 1)} and ${ordinalWord(g.to)}`;
    else who = `${ordinalWord(g.from)} through ${ordinalWord(g.to)}`;
    return `${who} win ${seatWord(g.n)} each.`;
  });
  const total = places.reduce((s, pl) => s + pkg[pl], 0);
  parts.push(`That is ${seatWord(total)}.`);
  const words = parts.join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the rules can say about ONE qualifier (the lobby's normalized item, or the server's raw one). Never throws. */
export function qualifierRulesContext(q) {
  const ctx = {};
  if (!q || typeof q !== 'object') return ctx;
  const pkgWords = seatPackageWords(q.seatPackage);
  const pkg = cleanSeatPackage(q.seatPackage);
  const sent = Number(q.seatsForTop);
  let top = Number.isInteger(sent) && sent > 0 && sent <= 100 ? sent : null;
  if (pkg) top = Math.max(...Object.keys(pkg).map(Number));
  if (top) {
    ctx.top = String(top);
    ctx.bubble = String(top + 1);
  }
  if (pkgWords) ctx.seatPackage = pkgWords;
  else if (top) ctx.noSeatPackage = true;
  if (q.lateRegClosesAtBubble === true) ctx.lateRegClosesAtBubble = true;
  if (q.seedsHeldUntilEnd === true) ctx.seedsHeldUntilEnd = true;
  return ctx;
}

function fill(text, ctx) {
  let missing = false;
  const out = String(text).replace(/\{(\w+)\}/g, (all, key) => {
    const v = ctx[key];
    if (typeof v !== 'string' || !v) { missing = true; return all; }
    return v;
  });
  return missing ? null : out;
}

/** One rule entry -> its words for this context, or null (not shown). */
export function resolveRule(rule, ctx = {}) {
  if (typeof rule === 'string') return fill(rule, ctx);
  if (!rule || typeof rule !== 'object') return null;
  const needs = Array.isArray(rule.needs) ? rule.needs : [];
  const met = needs.every((k) => !!ctx[k]);
  const chosen = met ? rule.text : rule.otherwise;
  return typeof chosen === 'string' && chosen ? fill(chosen, ctx) : null;
}

/**
 * The rules as they read for ONE qualifier (or, without one, with nothing
 * known about it): [{heading, rules:[string], compact?}], sections with no
 * line left dropped.
 */
export function qualifierRulesFor(q, sections = QUALIFIER_RULES) {
  const ctx = qualifierRulesContext(q);
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    const rules = (s?.rules || []).map((r) => resolveRule(r, ctx)).filter((r) => typeof r === 'string' && r);
    if (!rules.length) continue;
    out.push({ heading: s.heading, rules, ...(s.compact ? { compact: true } : {}) });
  }
  return out;
}

/**
 * The rules window's jump row (the section headings under the title): wrap it
 * onto several lines only on a screen both wide (>= 700 px) and tall
 * (>= 600 px). A phone, or a phone held sideways, gets one row that scrolls
 * sideways, so the sticky header never covers half the screen.
 */
export function rulesJumpRowWraps(width, height) {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w >= 700 && h >= 600;
}
