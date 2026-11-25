// 2026-11-21 (owner decisions: the Online League) - the .online client half.
// A free No-Limit Hold'em tournament Monday to Saturday at 6:00 PM MT (type
// 'online_league', kind 'league'): free Register / one Re-enter / Take your
// seat, the home card shows the SOONEST event (league Mon-Sat, the weekly from
// Saturday night), league copy says points + the top-5 weekly credit + the
// winner's 1-month seat subscription to a live game (only while the server
// gives them; owner 2026-11-25: never "a free month in a chair"; no
// championship-seat or credit-to-enter wording), standings link to the player app, the finish
// screen says the place + points, an older server's list behaves as today, and
// the monthly stays hidden.
// node:test, no dependency; loads the REAL modules (+ static guards on JSX).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isRedHue } from '../../src/utils/noRedHue.js';

const SRC_DIR = new URL('../../src/', import.meta.url);
const L = await import(new URL('utils/qualifierList.js', SRC_DIR).href);
const R = await import(new URL('content/qualifierRules.js', SRC_DIR).href);
const OLR = await import(new URL('content/onlineLeagueRules.js', SRC_DIR).href);
const F = await import(new URL('utils/tournamentFinish.js', SRC_DIR).href);
const readSrc = (rel) => fs.readFileSync(new URL(rel, SRC_DIR), 'utf8');

const LEAGUE_ID = '2e4d68d2-c71e-4447-b16d-38e31f3a9ffd';

// Sat Nov 28 2026: the league at 6:00 PM MST = 2026-11-29T01:00Z; the Sunday
// weekly at 11:00 AM MST = 2026-11-29T18:00Z; Monday's league 2026-12-01T01:00Z.
// League sign-up opens 3 hours before (3:00 PM MST = 22:00Z; owner 2026-11-25,
// poker-server 32533fe; it was 2 hours / 4:00 PM).
const leagueRaw = (over = {}) => ({
  qualifierId: 'ol-1128', masterQualifierId: 'ol-1128', type: 'online_league', name: 'Online League — Sat, Nov 28',
  scheduledAt: '2026-11-29T01:00:00.000Z', signupOpensAt: '2026-11-28T22:00:00.000Z',
  signupClosesAt: '2026-11-29T02:00:00.000Z', lateRegUntil: '2026-11-29T02:00:00.000Z',
  status: 'scheduled', registered: false, eliminated: false, reEntriesLeft: null, creditsHeld: null,
  maxReEntries: 1, reEntries: null, players: 0, seatsForTop: 0, seatPackage: null,
  kind: 'league', requiresCredit: false, leagueId: LEAGUE_ID, leaguePoints: true, leaguePrize: 'chair_month', leagueAwardsMinField: 1,
  ...over,
});
const weeklyRaw = (over = {}) => ({
  qualifierId: 'w-1129', type: 'weekly', name: 'Weekly Qualifier — Nov 29', status: 'scheduled',
  scheduledAt: '2026-11-29T18:00:00.000Z', signupOpensAt: '2026-11-29T15:00:00.000Z',
  signupClosesAt: '2026-11-29T21:00:00.000Z', lateRegUntil: '2026-11-29T21:00:00.000Z',
  seatsForTop: 10, seatPackage: { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 },
  ...over,
});

test('QUALIFIER_LIST_REQUEST is {kinds:[\'league\']} and every lobby list request sends it', () => {
  assert.deepEqual(L.QUALIFIER_LIST_REQUEST, { kinds: ['league'] });
  assert.ok(Object.isFrozen(L.QUALIFIER_LIST_REQUEST) && Object.isFrozen(L.QUALIFIER_LIST_REQUEST.kinds), 'never mutated by a caller');
  const lobby = readSrc('components/ui/QualifierLobby.jsx');
  const emits = [...lobby.matchAll(/emit\('getQualifierTournaments'([^)]*)\)/g)];
  assert.ok(emits.length >= 6, `every list request found (${emits.length})`);
  for (const m of emits) assert.equal(m[1], ', QUALIFIER_LIST_REQUEST', `emit${m[0]}`);
  // No other module asks for the qualifier list (the payload must not be forgotten there).
  for (const f of ['App.jsx', 'components/ui/Lobby.jsx', 'components/ui/QualifierDashboard.jsx', 'store/qualifierStore.js']) {
    assert.doesNotMatch(readSrc(f), /emit\('getQualifierTournaments'/, f);
  }
});

test('normalizeQualifierItem: the league fields pass through; an older server\'s item gets today\'s defaults', () => {
  const q = L.normalizeQualifierItem(leagueRaw());
  assert.equal(q.kind, 'league');
  assert.equal(q.requiresCredit, false);
  assert.equal(q.leagueId, LEAGUE_ID);
  assert.equal(q.leaguePoints, true);
  assert.equal(q.leaguePrize, 'chair_month');
  assert.equal(q.leagueAwardsMinField, 1);
  assert.equal(q.typeLabel, 'Online League');
  assert.equal(q.maxReEntries, 1);
  // Junk values are dropped, never guessed.
  const junk = L.normalizeQualifierItem(leagueRaw({
    kind: 'weird', requiresCredit: 'no', leagueId: 'javascript:alert(1)', leaguePoints: 'yes', leaguePrize: 'cash', leagueAwardsMinField: 0,
  }));
  assert.equal(junk.kind, 'league', 'kind from the type when the server sends none / junk');
  assert.equal(junk.requiresCredit, null);
  assert.equal(junk.leagueId, null);
  assert.equal(junk.leaguePoints, null);
  assert.equal(junk.leaguePrize, null);
  assert.equal(junk.leagueAwardsMinField, null);
  assert.equal(L.normalizeQualifierItem(leagueRaw({ leagueAwardsMinField: 6 })).leagueAwardsMinField, 6);
  assert.equal(L.normalizeQualifierItem(leagueRaw({ leagueAwardsMinField: 2.5 })).leagueAwardsMinField, null);
  // An older server (no new fields): kind 'qualifier', everything else null.
  const w = L.normalizeQualifierItem(weeklyRaw());
  assert.equal(w.kind, 'qualifier');
  for (const k of ['requiresCredit', 'leagueId', 'leaguePoints', 'leaguePrize', 'leagueAwardsMinField']) assert.equal(w[k], null, k);
  assert.equal(L.isLeagueItem(w), false);
  assert.equal(L.qualifierEntryIsFree(w), false);
  // A newer server's weekly (kind 'qualifier', requiresCredit true) is still a credit event.
  const w2 = L.normalizeQualifierItem(weeklyRaw({ kind: 'qualifier', requiresCredit: true, leagueId: null }));
  assert.equal(w2.kind, 'qualifier');
  assert.equal(L.qualifierEntryIsFree(w2), false);
});

test('qualifierTypeLabel / default name', () => {
  assert.equal(L.qualifierTypeLabel('online_league'), 'Online League');
  assert.equal(L.qualifierTypeLabel('weekly'), 'Weekly');
  assert.equal(L.qualifierTypeLabel('monthly'), 'Monthly');
  assert.equal(L.normalizeQualifierItem({ qualifierId: 'x', type: 'online_league' }).name, 'Online League');
  assert.equal(L.normalizeQualifierItem({ qualifierId: 'y', type: 'weekly' }).name, 'Weekly Qualifier');
});

test('qualifierIsQualified: a free event needs no credit; the weekly is unchanged', () => {
  const q = L.normalizeQualifierItem(leagueRaw({ creditsHeld: 0 }));
  assert.equal(L.qualifierIsQualified(q, undefined), true);
  assert.equal(L.qualifierIsQualified(q, false), true);
  assert.equal(L.qualifierIsQualified(q, { qualified: false, credits: 0 }), true);
  // A league item that does not say (requiresCredit null) is free too; one that says true is not.
  assert.equal(L.qualifierIsQualified(L.normalizeQualifierItem(leagueRaw({ requiresCredit: undefined })), undefined), true);
  assert.equal(L.qualifierIsQualified(L.normalizeQualifierItem(leagueRaw({ requiresCredit: true })), undefined), false);
  const w = L.normalizeQualifierItem(weeklyRaw());
  assert.equal(L.qualifierIsQualified(w, undefined), false);
  assert.equal(L.qualifierIsQualified(w, { qualified: true, credits: 1 }), true);
  assert.equal(L.qualifierIsQualified({ ...w, creditsHeld: 0 }, { qualified: true }), false, 'creditsHeld still wins for a weekly');
  assert.equal(L.qualifierIsQualified({ ...w, creditsHeld: 2 }, undefined), true);
});

test('featuredQualifier: the SOONEST event (league Mon-Sat, the weekly from Saturday night)', () => {
  const satAfternoon = Date.parse('2026-11-28T21:00:00Z'); // Sat 2:00 PM MT
  const list = L.normalizeQualifierList([weeklyRaw(), leagueRaw()]);
  assert.equal(L.featuredQualifier(list, satAfternoon).qualifierId, 'ol-1128', 'the Saturday league night comes before the Sunday weekly');
  // After Saturday's league finishes (Monday's night is listed too): the Sunday weekly.
  const satNight = Date.parse('2026-11-29T06:00:00Z'); // Sat 11:00 PM MT
  const monday = leagueRaw({ qualifierId: 'ol-1130', name: 'Online League — Mon, Nov 30', scheduledAt: '2026-12-01T01:00:00.000Z', signupOpensAt: '2026-11-30T22:00:00.000Z', signupClosesAt: '2026-12-01T02:00:00.000Z', lateRegUntil: '2026-12-01T02:00:00.000Z' });
  const after = L.normalizeQualifierList([leagueRaw({ status: 'finished' }), weeklyRaw(), monday]);
  assert.equal(L.featuredQualifier(after, satNight).qualifierId, 'w-1129');
  // A live weekly beats an upcoming league night.
  const sunNoon = Date.parse('2026-11-29T19:00:00Z');
  const liveWeekly = L.normalizeQualifierList([monday, weeklyRaw({ status: 'running' })]);
  assert.equal(L.featuredQualifier(liveWeekly, sunNoon).qualifierId, 'w-1129');
  // Sunday after the weekly: Monday's league night.
  const sunEvening = Date.parse('2026-11-30T02:00:00Z');
  const sunDone = L.normalizeQualifierList([weeklyRaw({ status: 'finished' }), monday]);
  assert.equal(L.featuredQualifier(sunDone, sunEvening).qualifierId, 'ol-1130');
  // A finished (or cancelled) league night never beats an upcoming one.
  const tue = leagueRaw({ qualifierId: 'ol-1201', scheduledAt: '2026-12-02T01:00:00.000Z', signupOpensAt: '2026-12-01T22:00:00.000Z', lateRegUntil: '2026-12-02T02:00:00.000Z', signupClosesAt: '2026-12-02T02:00:00.000Z' });
  const monNight = Date.parse('2026-12-01T05:00:00Z');
  for (const done of [{ status: 'finished' }, { status: 'finished', cancelled: true }]) {
    const l2 = L.normalizeQualifierList([{ ...monday, ...done }, tue]);
    assert.equal(L.featuredQualifier(l2, monNight).qualifierId, 'ol-1201', JSON.stringify(done));
  }
  // A live league night is shown while it runs (it is the soonest: now).
  const satEvening = Date.parse('2026-11-29T01:30:00Z');
  const liveLeague = L.normalizeQualifierList([weeklyRaw(), leagueRaw({ status: 'running' })]);
  assert.equal(L.featuredQualifier(liveLeague, satEvening).qualifierId, 'ol-1128');
  // The monthly stays hidden even beside a league night.
  const withMonthly = L.normalizeQualifierList([{ qualifierId: 'm', type: 'monthly', status: 'running', scheduledAt: '2026-11-28T18:00:00Z', lateRegUntil: '2026-11-28T23:00:00Z' }, leagueRaw()]);
  assert.equal(L.featuredQualifier(withMonthly, satAfternoon).qualifierId, 'ol-1128');
});

test('home "you" line for a league night: entered / 1 re-entry left / re-entry used / closed; never "credit"', () => {
  const base = L.normalizeQualifierItem(leagueRaw({ registered: true, reEntries: 0 }));
  const lines = [
    [L.qualifierHomeYouText(base, { state: 'open', registered: true, credits: 0, reentries: 0 }), "You're entered"],
    [L.qualifierHomeYouText({ ...base, eliminated: true, reEntriesLeft: 1 }, { state: 'late', registered: true, reentries: 1 }), "You're out · 1 re-entry left"],
    [L.qualifierHomeYouText({ ...base, eliminated: true, reEntriesLeft: 0, reEntries: 1 }, { state: 'late', registered: true, reentries: 0 }), "You're out · re-entry used"],
    [L.qualifierHomeYouText({ ...base, eliminated: true }, { state: 'running', registered: true, reentries: 1 }), "You're out · late entry is closed"],
    // Re-entries from the cap when the server sends no reEntriesLeft.
    [L.qualifierHomeYouText({ ...base, eliminated: true, reEntriesLeft: null, maxReEntries: 1, reEntries: 0 }, { state: 'late', registered: true }), "You're out · 1 re-entry left"],
    [L.qualifierHomeYouText({ ...base, eliminated: true, reEntriesLeft: null, maxReEntries: 1, reEntries: 1 }, { state: 'late', registered: true }), "You're out · re-entry used"],
  ];
  for (const [got, want] of lines) assert.equal(got, want);
  // Not registered: nothing (never "You hold N credits").
  assert.equal(L.qualifierHomeYouText(L.normalizeQualifierItem(leagueRaw({ creditsHeld: 3 })), { state: 'open', registered: false, credits: 3 }), null);
  for (const [got] of lines) assert.doesNotMatch(String(got), /credit/i);
  // The weekly is unchanged.
  const w = L.normalizeQualifierItem(weeklyRaw());
  assert.equal(L.qualifierHomeYouText(w, { state: 'open', registered: false, credits: 1 }), 'You hold 1 weekly credit · each entry uses 1');
  assert.equal(L.qualifierHomeYouText({ ...w, eliminated: true }, { state: 'late', registered: true, credits: 0, reentries: 0 }), "You're out · no credits left to re-enter");
});

test('leagueReentriesLeft: credits never limit a free event', () => {
  assert.equal(L.leagueReentriesLeft({ reEntriesLeft: 1 }), 1);
  assert.equal(L.leagueReentriesLeft({ reEntriesLeft: null, maxReEntries: 1, reEntries: 0 }), 1);
  assert.equal(L.leagueReentriesLeft({ maxReEntries: 1, reEntries: 2 }), 0);
  assert.equal(L.leagueReentriesLeft({}), null);
  assert.equal(L.leagueReentriesLeft(null), null);
});

test('be-online note: a free night promises no credit refund; the weekly note is unchanged', () => {
  const q = L.normalizeQualifierItem(leagueRaw());
  assert.equal(L.qualifierBeOnlineText(q), 'Be on americanpubpoker.online by 6:00 PM MT — anyone not here when it starts is released.');
  const w = L.normalizeQualifierItem(weeklyRaw());
  assert.equal(L.qualifierBeOnlineText(w), 'Be on americanpubpoker.online by 11:00 AM MT — anyone not here when it starts is released and the credit refunded.');
});

test('home card lines: free entry / 1 re-entry / 7:00 PM, points + top-5 credit and the prize only while on', () => {
  const on = L.onlineLeagueCardLines(L.normalizeQualifierItem(leagueRaw()));
  assert.deepEqual(on, {
    entry: 'Free entry · 1 re-entry · late entry until 7:00 PM MT',
    points: 'Every finisher earns league points; top 5 earn a weekly qualifier credit',
    prize: 'Winner: a 1-month seat subscription to a live game',
  });
  const off = L.onlineLeagueCardLines(L.normalizeQualifierItem(leagueRaw({ leaguePoints: false, leaguePrize: null })));
  assert.equal(off.points, null);
  assert.equal(off.prize, null);
  assert.equal(L.onlineLeagueCardLines(L.normalizeQualifierItem(leagueRaw({ leaguePoints: false }))).prize, null, 'no prize while points are off (it hangs off the night\'s game)');
  const min = L.onlineLeagueCardLines(L.normalizeQualifierItem(leagueRaw({ leagueAwardsMinField: 6 })));
  assert.equal(min.points, 'Every finisher earns league points; top 5 earn a weekly qualifier credit (nights with 6+ finishers)');
  assert.equal(min.prize, 'Winner: a 1-month seat subscription to a live game (nights with 6+ finishers)');
  assert.equal(L.onlineLeagueCardLines(L.normalizeQualifierItem(weeklyRaw())), null);
  // The only "seat" word is the prize's "seat subscription" (owner 2026-11-25), never a championship seat.
  for (const v of Object.values(on)) assert.doesNotMatch(v, /\bseat(?! subscription)|championship|uses 1 credit|credit to enter/i, v);
  for (const v of [on.prize, min.prize]) assert.doesNotMatch(v, /free month|chair/i, `owner 2026-11-25: never "a free month in a chair": ${v}`);
  // The card's "Sign-up opens" time is COMPUTED from the server's signupOpensAt
  // (3 hours before since poker-server 32533fe): 3:00 PM MT before it opens.
  assert.deepEqual(L.qualifierHomeStatus(L.normalizeQualifierItem(leagueRaw()), Date.parse('2026-11-28T21:00:00Z')), { state: 'scheduled', text: 'Sign-up opens 3:00 PM MT' });
  const about = L.onlineLeagueAboutText(L.normalizeQualifierItem(leagueRaw()));
  assert.match(about, /^Online League: free No-Limit Hold'em for every American Pub Poker member, Monday to Saturday at 6:00 PM MT\. Sign-up opens at 3:00 PM; late entry and one re-entry until 7:00 PM; 10-minute levels\./);
  assert.doesNotMatch(about, /4:00 PM/, 'owner 2026-11-25: sign-up opens 3 hours before (3:00 PM MT), never the old 4:00 PM');
  assert.match(about, /top 5 earn a weekly qualifier credit/);
  assert.match(about, /The winner gets a 1-month seat subscription \(4 games\) to a live American Pub Poker game\./);
  const aboutOff = L.onlineLeagueAboutText(L.normalizeQualifierItem(leagueRaw({ leaguePoints: false, leaguePrize: null })));
  assert.doesNotMatch(aboutOff, /credit|chair|seat subscription|points/i);
  assert.doesNotMatch(about, /\bseat(?! subscription)/i);
  assert.doesNotMatch(about, /free month|chair/i, 'owner 2026-11-25: never "a free month in a chair"');
});

test('finished line + Game Over: place + points; top-5 credit / prize only when given; never seat or chips', () => {
  const q = L.normalizeQualifierItem(leagueRaw({ status: 'finished', place: 3, wonSeat: false, myResult: { place: 3, wonSeat: false, seats: 0 } }));
  assert.equal(L.qualifierItemResultText(q), 'You finished 3rd. Points post to the Online League standings.');
  assert.equal(L.qualifierItemResultText({ ...q, leaguePoints: false }), 'You finished 3rd.');
  assert.equal(L.qualifierItemResultText({ ...q, result: null }), 'Points post to the Online League standings.');
  const w = L.normalizeQualifierItem(weeklyRaw({ status: 'finished', place: 2, wonSeat: true, myResult: { place: 2, wonSeat: true, seats: 2 } }));
  assert.equal(L.qualifierItemResultText(w), 'You finished 2nd — you won 2 championship seats!', 'the weekly line is unchanged');

  const frame = (over = {}) => ({
    tournamentId: 't-ol', isQualifier: true, qualifierId: 'ol-1128', kind: 'league', leagueId: LEAGUE_ID,
    leaguePoints: true, leaguePrize: 'chair_month', leagueAwardsMinField: 1, field: 12,
    results: [{ place: 1, playerName: 'Ann B.', wonSeat: false, seats: 0 }], ...over,
  });
  const third = L.tournamentCompleteMessage(frame({ place: 3, myResult: { place: 3, wonSeat: false, seats: 0 }, wonSeat: false }), 'u1');
  assert.equal(third, "Online League complete! You finished 3rd. Points post to the Online League standings. Top 5 earn a weekly qualifier credit for Sunday's Weekly Qualifier - yours shows in the American Pub Poker app.");
  const first = L.tournamentCompleteMessage(frame({ place: 1, wonSeat: false }), 'u1');
  assert.ok(first.startsWith('Online League complete! You finished 1st. Points post to the Online League standings. Top 5 earn'));
  assert.ok(first.endsWith(' You won a 1-month seat subscription to a live game - claim it in the American Pub Poker app.'));
  assert.doesNotMatch(first, /free month|chair/i, 'owner 2026-11-25: never "a free month in a chair"');
  const sixth = L.tournamentCompleteMessage(frame({ place: 6 }), 'u1');
  assert.equal(sixth, 'Online League complete! You finished 6th. Points post to the Online League standings.');
  // Points off: no points / credit / prize sentence.
  assert.equal(L.tournamentCompleteMessage(frame({ place: 1, leaguePoints: false }), 'u1'), 'Online League complete! You finished 1st.');
  // leaguePoints unknown (null): the points sentence, but no credit promise.
  assert.equal(L.tournamentCompleteMessage(frame({ place: 2, leaguePoints: null, leaguePrize: null }), 'u1'), 'Online League complete! You finished 2nd. Points post to the Online League standings.');
  // Prize off: no prize line for the winner.
  assert.doesNotMatch(L.tournamentCompleteMessage(frame({ place: 1, leaguePrize: null }), 'u1'), /seat subscription|chair/);
  // Below the minimum field: points only.
  const small = L.tournamentCompleteMessage(frame({ place: 1, leagueAwardsMinField: 6, field: 5 }), 'u1');
  assert.equal(small, 'Online League complete! You finished 1st. Points post to the Online League standings.');
  assert.match(L.tournamentCompleteMessage(frame({ place: 1, leagueAwardsMinField: 6, field: 6 }), 'u1'), /1-month seat subscription/);
  assert.doesNotMatch(L.tournamentCompleteMessage(frame({ place: 1, leagueAwardsMinField: 6, field: undefined }), 'u1'), /credit|seat subscription|chair/, 'unknown field + a minimum: no promise');
  // A spectator (no own place).
  assert.equal(L.tournamentCompleteMessage(frame({}), null), 'Online League complete! Points post to the Online League standings.');
  for (const m of [third, first, sixth, small]) {
    assert.doesNotMatch(m, /\bseat(?! subscription)|chips|Qualifier complete/i, m);
  }
  // The Game Over overlay: no chip own-line, no chip bankroll result for a league night.
  assert.deepEqual(F.finishOverlay(frame({ place: 3 }), 'u1'), { message: L.tournamentCompleteMessage(frame({ place: 3 }), 'u1'), ownLine: '' });
  const bare = { ...frame({ place: 3, results: [{ userId: 'u1', position: 3, playerName: 'Me' }] }), isQualifier: undefined, qualifierId: undefined };
  assert.equal(F.finishOverlay(bare, 'u1').ownLine, '', 'kind league alone is enough (no "You finished 3rd" chip line)');
  assert.equal(F.finishFrameOwnResult(bare, 'u1').prize, null, 'read by the qualifier rule: no prize');
  assert.equal(F.tournamentResultFrom({ ...frame({ place: 3 }), isQualifier: undefined, qualifierId: undefined, results: [{ userId: 'u1', position: 3, prize: 0 }] }, 'u1'), null);
  // Weekly / chip frames are unchanged.
  assert.equal(L.tournamentCompleteMessage({ isQualifier: true, place: 3, wonSeat: true }, 'u1'), 'Qualifier complete! You finished 3rd — you won a championship seat!');
  assert.equal(L.tournamentCompleteMessage({ results: [{ position: 1, playerName: 'Bo', payout: 270 }] }, 'u1'), 'Tournament Complete! Bo wins 270 chips!');
});

test('Online League Rules: own title / subtitle / date, plain ASCII, the drafted sections, lines follow the switches', () => {
  assert.equal(OLR.ONLINE_LEAGUE_RULES_TITLE, 'Online League Rules');
  assert.equal(OLR.ONLINE_LEAGUE_RULES_UPDATED, '2026-11-25');
  const raw = JSON.stringify(OLR.ONLINE_LEAGUE_RULES);
  assert.ok(/^[\x20-\x7e]*$/.test(raw), 'plain ASCII (AGENT.md rule 20)');
  assert.doesNotMatch(raw, /4:00 PM/, 'owner 2026-11-25: sign-up opens at 3:00 PM MT, never the old 4:00 PM');
  assert.doesNotMatch(raw, /monthly|championship seat/i);
  assert.doesNotMatch(raw, /free month|in a chair|chair availability/i, 'owner 2026-11-25: the prize is a 1-month seat subscription, never "a free month in a chair"');
  const q = L.normalizeQualifierItem(leagueRaw());
  assert.equal(R.qualifierHasLeagueRules(q), true);
  assert.equal(R.qualifierHasWeeklyRules(q), false);
  assert.equal(R.qualifierHasLeagueRules(L.normalizeQualifierItem(weeklyRaw())), false);
  assert.equal(R.qualifierHasLeagueRules({ kind: 'league' }), true);
  assert.equal(R.qualifierHasLeagueRules(null), false);
  const page = R.rulesPageFor(q);
  assert.equal(page.title, 'Online League Rules');
  assert.equal(page.subtitle, 'Monday to Saturday at 6:00 PM MT on americanpubpoker.online');
  assert.equal(page.updated, 'Updated Nov 25, 2026.');
  const headings = page.sections.map((s) => s.heading);
  assert.deepEqual(headings, ['Free to enter', 'Who can play', 'Schedule', 'Points and weekly credits', "Nightly winner's prize", 'Fair play']);
  const lines = page.sections.flatMap((s) => s.rules);
  for (const want of [
    'The Online League is free. No purchase or payment of any kind is needed to enter, play or win.',
    'Buying chips, VIP or anything else gives no advantage.',
    'Chips are play money with no cash value.',
    'One account per person.',
    'Sign-up opens at 3:00 PM MT. Tap Register on the Online League card.',
    'Late entry and one re-entry are open until 7:00 PM MT.',
    'The top 5 each night earn a weekly qualifier credit for the Sunday Weekly Qualifier.',
    'The winner each night gets a 1-month seat subscription (4 weekly games) to a live American Pub Poker game the winner chooses.',
    'No purchase, VIP or card is needed to claim it. The 1-month seat subscription is never charged.',
    "The prize depends on seat availability and the venue's own house rules, including age limits.",
    'It has no cash value and cannot be transferred. Claim it in the American Pub Poker app within 90 days.',
    'American Pub Poker may void points, credits or prizes for multiple accounts, collusion or cheating.',
  ]) assert.ok(lines.includes(want), `missing: ${want}`);
  // Points off / prize off: those sections are not shown (never a promise the server does not keep).
  const offHeadings = R.rulesPageFor({ ...q, leaguePoints: false, leaguePrize: null }).sections.map((s) => s.heading);
  assert.deepEqual(offHeadings, ['Free to enter', 'Who can play', 'Schedule', 'Fair play']);
  assert.equal(R.rulesPageFor({ ...q, leaguePoints: false }).sections.some((s) => s.heading === "Nightly winner's prize"), false);
  // A minimum field adds its line.
  const minLines = R.rulesPageFor({ ...q, leagueAwardsMinField: 6 }).sections.flatMap((s) => s.rules);
  assert.ok(minLines.includes('On a night with fewer than 6 finishers, points still count, but no weekly qualifier credits or prizes are given.'));
  assert.equal(lines.some((l) => /fewer than/.test(l)), false, 'no minimum line without a minimum');
  // The weekly page is unchanged.
  const wPage = R.rulesPageFor(L.normalizeQualifierItem(weeklyRaw()));
  assert.equal(wPage.title, R.QUALIFIER_RULES_TITLE);
  assert.equal(wPage.subtitle, R.QUALIFIER_RULES_SUBTITLE);
  assert.deepEqual(wPage.sections, R.qualifierRulesFor(L.normalizeQualifierItem(weeklyRaw())));
  assert.deepEqual(R.rulesPageFor(null).sections, R.qualifierRulesFor(null));
});

// ── Static guards on the JSX (no React renderer in node) ────────────────────

const LOBBY = readSrc('components/ui/QualifierLobby.jsx');
const DASH = readSrc('components/ui/QualifierDashboard.jsx');
const RULES = readSrc('components/ui/QualifierRules.jsx');
const APP = readSrc('App.jsx');

function between(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `marker: ${to}`);
  return src.slice(a, b);
}

function hexColors(src) {
  return [...src.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => {
    const n = parseInt(m[1], 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { text: m[0], h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return { text: m[0], h, s, l };
  });
}

test('lobby league branches: no credit words, no red, broadcast notice skipped, standings built at the tap', () => {
  const info = between(LOBBY, 'const leagueInfo = (q) =>', '// 2026-11-02 (owner: stream the qualifiers) — next to Register');
  const listBox = between(LOBBY, '{league ? (\n            <div className="online-league-about"', '/* How to qualify');
  for (const seg of [info, listBox]) {
    assert.doesNotMatch(seg.replace(/\/\/[^\n]*/g, ''), /credit/i, 'no credit words in the league JSX (its lines come from onlineLeagueCardLines)');
    for (const c of hexColors(seg)) assert.ok(!(isRedHue(c.h) && c.s >= 0.3 && c.l >= 0.1 && c.l <= 0.95), `no red: ${c.text}`);
    assert.doesNotMatch(seg, /\bred\b/);
  }
  assert.match(info, /className="online-league-line"/);
  assert.match(info, /className="online-league-standings"/);
  assert.match(info, /openLeagueStandings\(q\.leagueId\)/);
  // The bridged URL is built in the click handler, never rendered (no href).
  const open = between(LOBBY, 'function openLeagueStandings(leagueId) {', '\n}\n');
  assert.match(open, /`\$\{PLAYER_APP\}\/leaderboards\?league=\$\{encodeURIComponent\(leagueId\)\}`/);
  assert.match(open, /window\.open\(withBridge\(url\), '_blank', 'noopener'\)/);
  assert.doesNotMatch(LOBBY, /href=\{[^}]*withBridge/);
  // Free labels, no credit words.
  for (const label of ["'Register — Free'", "'Late Register — Free'", '`Re-enter (${reEntriesLeft} left)`', "'Cancelled.'", "'You are out of this Online League game.'"]) {
    assert.ok(LOBBY.includes(label), label);
  }
  // The weekly labels are kept.
  for (const label of ["'Re-enter (uses 1 credit)'", "'Late Register (uses 1 credit)'", "\"Register — You're Qualified!\"", "'Cancelled. Any qualifier credit it used was refunded.'"]) {
    assert.ok(LOBBY.includes(label), label);
  }
  // Broadcast notice: returns null for a league night (still mounted twice, rule kept).
  const notice = between(LOBBY, 'const broadcastNotice = (q) => {', 'return (');
  assert.match(notice, /if \(isLeagueItem\(q\)\) return null;/);
  assert.equal((LOBBY.match(/\{broadcastNotice\(q\)\}/g) || []).length, 2);
  // Home card: eyebrows, the league lines, rules + standings; ONE mount.
  for (const t of ["'Online League live now'", "'Next Online League game'", "'Latest Online League game'", "rulesLink(q, league ? 'Online League Rules' : 'Rules')", '{league && leagueInfo(q)}', '{standingsLink(q)}']) {
    assert.ok(LOBBY.includes(t), t);
  }
  assert.match(LOBBY, /TYPE_ICONS = \{ weekly: '🗓️', monthly: '🏆', online_league: '🃏' \}/);
  assert.match(LOBBY, /TYPE_COLORS = \{ weekly: '#ffd24a', monthly: '#9db8ff', online_league: '#6abaff' \}/);
  assert.equal((readSrc('components/ui/Lobby.jsx').match(/<QualifierLobby variant="home"/g) || []).length, 1, 'one home mount');
});

test('detail window + rules window + cancelled notices follow the league', () => {
  assert.match(DASH, /const hasRules = qualifierHasWeeklyRules\(q\) \|\| qualifierHasLeagueRules\(q\);/);
  assert.match(DASH, /if \(!league && \(seatsLine \|\| resultLine\)\) tabs\.push\(\{ key: 'prizes', label: 'Seats' \}\);/);
  assert.match(DASH, /\{!isRegistered && isQualified && !isFinished && !freeEntry && <div style=\{\{ color: '#ffd24a' \}\}>You have a qualifier credit for this event\.<\/div>\}/);
  assert.match(DASH, /<p style=\{\{ margin: 0 \}\}>\{onlineLeagueAboutText\(q\)\}<\/p>/);
  // The window's title, subtitle, date and sections come from rulesPageFor (league or weekly).
  assert.match(RULES, /\{page\.title\}/);
  assert.match(RULES, /\{page\.subtitle\}/);
  assert.match(RULES, /<QualifierRulesBody idPrefix=\{prefix\} qualifier=\{qualifier\} sections=\{sections\} \/>/);
  assert.doesNotMatch(RULES, /QUALIFIER_RULES_TITLE|QUALIFIER_RULES_SUBTITLE/, 'no hard-wired weekly title');
  // qualifierCancelled: league titles; the weekly titles and the monthly guard kept.
  const h = between(APP, 'const handleQualifierCancelled = (d) => {', "socket.on('qualifierCancelled', handleQualifierCancelled);");
  assert.match(h, /const league = d\?\.kind === 'league';/);
  for (const t of ["'Online League cancelled'", "'Online League started without you'", "'Qualifier cancelled'", "'Qualifier started without you'"]) assert.ok(h.includes(t), t);
  assert.match(h, /const hiddenMonthly = monthlyQualifierHidden\(d\);/);
});

test('monthly stays hidden: the flag and the list filter are untouched', async () => {
  const M = await import(new URL('utils/monthlyQualifiers.js', SRC_DIR).href);
  assert.equal(M.MONTHLY_QUALIFIERS_SHOWN, false);
  assert.match(LOBBY, /const next = withoutHiddenMonthlyQualifiers\(all\);/);
  // A league night is never mistaken for a monthly one.
  assert.equal(M.isMonthlyQualifier(L.normalizeQualifierItem(leagueRaw())), false);
});

// Repair round 2 (added): the owner gave the Online League's top 5 the WEEKLY
// credit; the weekly's credit copy names that route while a league night gives it.
test('repair round 2: the weekly credit copy names the Online League route only while a listed league night gives credits', () => {
  const list = (items) => L.normalizeQualifierList(items);
  assert.equal(L.onlineLeagueGivesWeeklyCredit(list([weeklyRaw(), leagueRaw()])), true);
  assert.equal(L.onlineLeagueGivesWeeklyCredit(list([weeklyRaw()])), false, 'an older server / league off: no league item');
  assert.equal(L.onlineLeagueGivesWeeklyCredit(list([weeklyRaw(), leagueRaw({ leaguePoints: false, leaguePrize: null })])), false, 'points off: no credits');
  assert.equal(L.onlineLeagueGivesWeeklyCredit(null), false);
  assert.match(L.ONLINE_LEAGUE_WEEKLY_ROUTE_TEXT, /top 5 in a nightly Online League game/);
  assert.doesNotMatch(L.ONLINE_LEAGUE_WEEKLY_ROUTE_TEXT, /monthly/i);
  // Lobby: the "Not yet qualified" line and HOW TO QUALIFY, weekly only; the shipped lines kept as they were.
  assert.ok(LOBBY.includes("'Not yet qualified — finish top 5 in any live game to earn entry'"));
  assert.match(LOBBY, /q\.type === 'weekly' && onlineLeagueGivesWeeklyCredit\(list\)\s*\?\s*'Not yet qualified — finish top 5 in any live game or in a nightly Online League game to earn entry'/);
  assert.match(LOBBY, /\{q\.type === 'weekly' && onlineLeagueGivesWeeklyCredit\(list\) && \(\s*<div className="online-league-credit-route"[^>]*>\{ONLINE_LEAGUE_WEEKLY_ROUTE_TEXT\}<\/div>/);
  assert.match(LOBBY, /onlineLeagueCredit=\{onlineLeagueGivesWeeklyCredit\(list\)\}/);
  // Detail window: a second paragraph under the shipped weekly one.
  assert.match(DASH, /onClose, onlineLeagueCredit = false \}\)/);
  assert.match(DASH, /\{q\.type === 'weekly' && onlineLeagueCredit && \(\s*<p className="online-league-credit-route"[^>]*>\{ONLINE_LEAGUE_WEEKLY_ROUTE_TEXT\}<\/p>/);
  for (const seg of [LOBBY, DASH]) {
    const at = seg.indexOf('online-league-credit-route');
    for (const c of hexColors(seg.slice(at - 200, at + 300))) assert.ok(!(isRedHue(c.h) && c.s >= 0.3 && c.l >= 0.1 && c.l <= 0.95), `no red: ${c.text}`);
  }
  // The owner-approved Weekly Qualifier Rules text is NOT edited here (owner question).
  assert.match(readSrc('content/qualifierRules.js'), /You earn one weekly qualifier credit each time you finish in the top 5 of an American Pub Poker live game/);
});
