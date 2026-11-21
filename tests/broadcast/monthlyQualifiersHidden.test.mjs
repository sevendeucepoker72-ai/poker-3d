// 2026-11-21 (owner, twice: "I said turn them off. Don't show them at all." /
// "Do not show the monthly qualifiers.") - the MONTHLY online qualifier is
// hidden on .online behind ONE flag (src/utils/monthlyQualifiers.js,
// MONTHLY_QUALIFIERS_SHOWN = false): no list row, home card or cancelled card,
// no "Monthly Major" / "advance to the monthly" / 3rd-Saturday / monthly
// credit text, no monthly rules lines, the broadcast page shows its slate.
// The VIP monthly bonus and staff tools are NOT this flag.
// node:test, no dependency; loads the REAL modules (+ static guards on JSX).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC_DIR = new URL('../../src/', import.meta.url);
const M = await import(new URL('utils/monthlyQualifiers.js', SRC_DIR).href);
const L = await import(new URL('utils/qualifierList.js', SRC_DIR).href);
const R = await import(new URL('content/qualifierRules.js', SRC_DIR).href);
const S = await import(new URL('broadcast/model/sceneMachine.js', SRC_DIR).href);
const readSrc = (rel) => fs.readFileSync(new URL(rel, SRC_DIR), 'utf8');

const MONTHLY_TEXT = /monthly|3rd saturday|third saturday|monthly major/i;
const NOW = Date.parse('2026-11-21T18:00:00Z');

const weekly = {
  qualifierId: 'w-1122', type: 'weekly', name: 'Weekly Qualifier', status: 'scheduled',
  scheduledAt: '2026-11-22T18:00:00Z', signupOpensAt: '2026-11-22T15:00:00Z', signupClosesAt: '2026-11-22T21:00:00Z',
};
const monthlyCancelled = {
  qualifierId: 'm-1121', type: 'monthly', name: 'Monthly Major Qualifier', status: 'finished', cancelled: true,
  scheduledAt: '2026-11-21T18:00:00Z',
};

test('the flag is ONE constant, off (owner 2026-11-21)', () => {
  assert.equal(M.MONTHLY_QUALIFIERS_SHOWN, false);
  const src = readSrc('utils/monthlyQualifiers.js');
  assert.match(src, /export const MONTHLY_QUALIFIERS_SHOWN = false;/);
  assert.match(src, /owner 2026-11-21; set true to show the monthly qualifiers again/);
});

test('isMonthlyQualifier: type monthly / console_monthly, kind, or a monthly name; never a weekly one', () => {
  for (const item of [
    { type: 'monthly' }, { type: 'console_monthly' }, { qualifierType: 'Monthly' }, { kind: 'monthly' },
    { name: 'Monthly Major Qualifier' }, { qualifierName: 'Monthly Major Qualifier' }, { title: 'Monthly Online Qualifier' },
  ]) assert.equal(M.isMonthlyQualifier(item), true, JSON.stringify(item));
  for (const item of [null, undefined, 'monthly', {}, { type: 'weekly' }, { type: 'console_weekly' }, { kind: 'sitgo', name: 'Sit & Go 9' }, weekly]) {
    assert.equal(M.isMonthlyQualifier(item), false, JSON.stringify(item));
  }
});

test('withoutHiddenMonthlyQualifiers drops monthly items while off; the flag on keeps the list as it is', () => {
  const list = [monthlyCancelled, weekly, { qualifierId: 'cm', type: 'console_monthly' }];
  assert.deepEqual(M.withoutHiddenMonthlyQualifiers(list).map((q) => q.qualifierId), ['w-1122']);
  assert.equal(M.withoutHiddenMonthlyQualifiers(list, true), list);
  const weeklyOnly = [weekly];
  assert.equal(M.withoutHiddenMonthlyQualifiers(weeklyOnly), weeklyOnly, 'same array when nothing is hidden');
  assert.deepEqual(M.withoutHiddenMonthlyQualifiers(null), []);
  assert.equal(M.monthlyQualifierHidden(monthlyCancelled), true);
  assert.equal(M.monthlyQualifierHidden(monthlyCancelled, true), false);
  assert.equal(M.monthlyQualifierHidden(weekly), false);
});

test('home card: never a monthly event (not even its cancelled card); none at all when only a monthly is listed', () => {
  const list = L.normalizeQualifierList([monthlyCancelled, weekly]);
  assert.equal(list.length, 2, 'normalizeQualifierList keeps every item (help tools stay off at a monthly table)');
  assert.equal(L.featuredQualifier(list, NOW).qualifierId, 'w-1122');
  assert.equal(L.featuredQualifier(L.normalizeQualifierList([monthlyCancelled]), NOW), null);
  // A live monthly would win the slot before the flag; it is skipped now.
  const liveMonthly = { ...monthlyCancelled, status: 'running', cancelled: false, lateRegUntil: '2026-11-21T21:00:00Z' };
  assert.equal(L.featuredQualifier(L.normalizeQualifierList([liveMonthly, weekly]), NOW).qualifierId, 'w-1122');
});

test('no monthly name or "monthly credits" line from the list helpers while hidden', () => {
  const unnamed = L.normalizeQualifierItem({ qualifierId: 'm2', type: 'monthly', status: 'registering' });
  assert.doesNotMatch(unnamed.name, MONTHLY_TEXT, 'a nameless monthly item gets no "Monthly Major Qualifier" default');
  const you = L.qualifierHomeYouText(unnamed, { state: 'open', registered: false, credits: 2 });
  assert.equal(you, 'You hold 2 qualifier credits · each entry uses 1');
  const weeklyItem = L.normalizeQualifierItem(weekly);
  assert.equal(weeklyItem.name, 'Weekly Qualifier');
  assert.equal(L.qualifierHomeYouText(weeklyItem, { state: 'open', registered: false, credits: 1 }), 'You hold 1 weekly credit · each entry uses 1');
});

test('Weekly Qualifier Rules: no monthly line; the mixed lines read without their monthly part', () => {
  for (const q of [null, { type: 'weekly', seatsForTop: 3 }, { type: 'weekly', seatPackage: { 1: 3, 2: 2 }, lateRegClosesAtBubble: true, seedsHeldUntilEnd: true }]) {
    const lines = R.qualifierRulesFor(q).flatMap((s) => s.rules);
    for (const l of lines) assert.doesNotMatch(l, MONTHLY_TEXT, l);
    assert.ok(lines.includes('If you are suspended, you cannot enter. If you are suspended during the qualifier, you are removed within a hand or two and get no place or seat.'));
    assert.ok(lines.includes('If the game server restarts after sign-up opens and before the qualifier ends, the qualifier is cancelled. Every credit it used, entries and re-entries, is returned. No seats come from it.'));
    // Fair play: the only credits a weekly awards are monthly credits, so the
    // "seats and credits you won" wording is hidden with them.
    assert.ok(lines.includes('If you cheat or break these rules, you are removed from the qualifier with no place or seat. The seats you won in that qualifier are taken back, and you may be suspended from all American Pub Poker games.'));
    for (const l of lines) assert.doesNotMatch(l, /credits you won/i, l);
  }
  const raw = JSON.stringify(R.QUALIFIER_RULES);
  assert.doesNotMatch(raw, MONTHLY_TEXT, 'the rules data the page renders has no monthly text');
  // The seat lines of Prizes are untouched.
  const prizes = R.qualifierRulesFor(null).find((s) => s.heading === 'Prizes');
  assert.ok(prizes.rules.includes('If you win again in another week, you earn more seats, up to the 10-seat limit.'));
  assert.ok(prizes.rules.some((l) => l.startsWith('When the qualifier ends, the results are sent to American Pub Poker')));
  // The original lines stay in the source behind the flag.
  const src = readSrc('content/qualifierRules.js');
  for (const t of ['each earn a monthly qualifier credit', 'The monthly qualifier is the 3rd Saturday of each month at 11:00 AM MT.', 'get no place, seat or monthly credit.', 'No seats or monthly credits come from it.', 'The seats and credits you won in that qualifier are taken back, and you may be suspended from all American Pub Poker games.']) {
    assert.ok(src.includes(t), `kept behind the flag: ${t}`);
  }
  assert.match(src, /\.\.\.\(MONTHLY_QUALIFIERS_SHOWN \? \[/);
});

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`broadcast/dev/fixtures/${name}.json`, SRC_DIR), 'utf8')).snapshot.program;

test('broadcast: a monthly program is the slate (channel, next:monthly, event kind or name), pinned or not', () => {
  const base = fixture('starting');
  const at = base.programNow;
  assert.equal(S.chooseScene({ program: base, programNow: at }).id, 'starting', 'a weekly program is unchanged');
  const monthlies = [
    { ...base, channel: 'monthly' },
    { ...base, eventKey: 'next:monthly' },
    { ...base, event: { ...base.event, kind: 'monthly' } },
    { ...base, channel: 'main', eventKey: 'q:x', event: { ...base.event, name: 'Monthly Major Qualifier' } },
  ];
  for (const p of monthlies) {
    assert.deepEqual(S.chooseScene({ program: p, programNow: at }), { id: 'slate', reason: 'monthly_hidden', pinned: false });
    const pinned = { ...p, scene: { id: 'table', auto: false, since: 0 } };
    assert.equal(S.chooseScene({ program: pinned, programNow: at }).id, 'slate', 'a producer pin does not bring it back');
    assert.equal(M.broadcastMonthlyHidden(p, true), false, 'the flag on shows it again');
  }
  for (const name of ['midgame', 'results', 'break', 'hfh', 'finalTable']) {
    const p = fixture(name);
    assert.notEqual(S.chooseScene({ program: p, programNow: p.programNow }).reason, 'monthly_hidden', name);
  }
});

test('JSX guards: monthly copy only behind the flag; the lobby list is filtered; no-show notice never names one', () => {
  const lobby = readSrc('components/ui/QualifierLobby.jsx');
  assert.match(lobby, /const next = withoutHiddenMonthlyQualifiers\(all\);/);
  assert.match(lobby, /noteQualifierTournamentIds\(all\)/, 'help tools stay off at every qualifier table');
  assert.match(lobby, /\{MONTHLY_QUALIFIERS_SHOWN && q\.type === 'monthly' \? \(\s*<>Three ways in:/);
  assert.match(lobby, /\) : MONTHLY_QUALIFIERS_SHOWN \? \(\s*<>Finish[^\n]*the top 10% advance to the Monthly Major\.<\/>/);
  assert.match(lobby, /\) : \(\s*<>Finish <strong style=\{\{ color: '#fff' \}\}>top 5 in any live game<\/strong> at any venue to earn a credit and an entry here\.\{seatsLine \? ` \$\{seatsLine\} at Bally's Blackhawk\.` : ''\}<\/>/);
  assert.match(lobby, /\{MONTHLY_QUALIFIERS_SHOWN && q\.type === 'monthly'\s*\?\s*`Not yet qualified/);
  assert.match(lobby, /monthlyQualifierHidden\(\{ type: String\(tier\) \}\) \? '' : `\$\{tier\} `/);
  const dash = readSrc('components/ui/QualifierDashboard.jsx');
  assert.match(dash, /\{MONTHLY_QUALIFIERS_SHOWN && q\.type === 'monthly' \? \(\s*<p style=\{\{ margin: 0 \}\}>Monthly Major Qualifier/);
  assert.match(dash, /\) : MONTHLY_QUALIFIERS_SHOWN \? \(\s*<p[^\n]*the top 10% advance to the monthly online qualifier\.<\/p>/);
  assert.match(dash, /\{seatsLine \? ` \$\{seatsLine\} at the Championship at Bally's Blackhawk\.` : ''\}<\/p>/);
  const app = readSrc('App.jsx');
  assert.match(app, /const hiddenMonthly = monthlyQualifierHidden\(d\);/);
  assert.match(app, /const late = !hiddenMonthly && d\?\.lateRegOpen/);
});

test('NOT this flag: the VIP monthly bonus and the staff tools are unchanged', () => {
  const vip = readSrc('components/ui/VIPPanel.jsx');
  assert.ok(vip.includes('Collect monthly VIP bonus'));
  assert.ok(vip.includes("socket.emit('claimVipMonthly'"));
  assert.ok(readSrc('components/producer/EventPicker.jsx').includes("{ eventKey: 'next:monthly', name: 'Next Monthly (auto-advance)' }"));
  for (const f of ['components/ui/VIPPanel.jsx', 'components/ui/ShopTab.jsx', 'components/ui/AdminDashboard.jsx', 'components/producer/EventPicker.jsx', 'store/qualifierStore.js']) {
    assert.equal(readSrc(f).includes('MONTHLY_QUALIFIERS_SHOWN'), false, `${f} is not gated`);
  }
});
