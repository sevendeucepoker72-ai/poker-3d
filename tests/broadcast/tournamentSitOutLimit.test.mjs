// 2026-11-26 (owner orders 2026-11-25, every tournament) - the .online client
// half of FIX 1 (a table under 4 players waits for balancing while 2+ tables
// play: gameState.tableHold 'short_table') and FIX 2 (nobody sits out more
// than 30 hands in a row: the 3-hand warning 'tournamentSitOutWarning', the
// per-socket count gameState.mySitOutLimit, the removal reason 'sat_out_limit'
// on the elimination payloads, the list item's sitOutLimitHands /
// minTablePlayers for the rules). Every field is optional: an older server
// sends none, and the client then says exactly what it says today.
// node:test, no dependency; loads the REAL pure modules (+ static guards on JSX).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isRedHue } from '../../src/utils/noRedHue.js';

const SRC_DIR = new URL('../../src/', import.meta.url);
const S = await import(new URL('utils/tournamentSitOut.js', SRC_DIR).href);
const L = await import(new URL('utils/qualifierList.js', SRC_DIR).href);
const R = await import(new URL('content/qualifierRules.js', SRC_DIR).href);
const readSrc = (rel) => fs.readFileSync(new URL(rel, SRC_DIR), 'utf8');
const CANON = fs.readFileSync(new URL('../../canonical-features.txt', import.meta.url), 'utf8');

const NOW = Date.parse('2026-11-28T23:30:00.000Z'); // 4:30 PM MST, before a league night's late entry closes
const LATER = Date.parse('2026-11-29T02:00:00.000Z'); // 7:00 PM MST (lateRegUntil)
const ASCII = /^[\x20-\x7e]*$/;
const NEVER = /chips went back|your balance|released|refund/i;

// ── Pure builders ───────────────────────────────────────────────────────────

test('warning toast: exact copy for N hands left, 1 hand left, protected, and an unknown count', () => {
  const base = { tournamentId: 't1', tableId: 'tb1', handsSatOut: 3, handsLimit: 30, handsLeft: 27, protectedUntil: null, message: 'server copy' };
  assert.equal(S.sitOutWarningText(base, NOW),
    'You have sat out 3 hands in a row. Come back within 27 hands or you will be removed from the tournament.');
  // handsLeft not sent: limit - sat out.
  assert.equal(S.sitOutWarningText({ ...base, handsLeft: undefined }, NOW),
    'You have sat out 3 hands in a row. Come back within 27 hands or you will be removed from the tournament.');
  assert.equal(S.sitOutWarningText({ ...base, handsSatOut: 29, handsLeft: 1 }, NOW),
    'You have sat out 29 hands in a row. Come back this hand or you will be removed from the tournament.');
  assert.equal(S.sitOutWarningText({ ...base, handsSatOut: 30, handsLeft: 0 }, NOW),
    'You have sat out 30 hands in a row. Come back this hand or you will be removed from the tournament.');
  // An Online League no-show before late entry closes (protectedUntil in the future).
  assert.equal(S.sitOutWarningText({ ...base, protectedUntil: LATER }, NOW),
    'You have sat out 3 hands in a row. If you are still away when late entry closes, you will be removed from the tournament.');
  // Protection over: the hands copy.
  assert.equal(S.sitOutWarningText({ ...base, protectedUntil: LATER }, LATER + 1), S.sitOutWarningText(base, NOW));
  // Unknown count: the rule, never a made-up number.
  assert.equal(S.sitOutWarningText({ tournamentId: 't1' }, NOW), "You are sitting out. You can't sit out more than 30 hands in a row.");
  assert.equal(S.sitOutWarningText({ handsSatOut: 3 }, NOW), "You have sat out 3 hands in a row. You can't sit out more than 30 hands in a row.");
  assert.equal(S.sitOutWarningText({ handsSatOut: 1, handsLimit: 30 }, NOW), 'You have sat out 1 hand in a row. Come back within 29 hands or you will be removed from the tournament.');
  for (const bad of [null, undefined, 'x', 3, []]) assert.equal(S.sitOutWarningText(bad, NOW), '');
});

test('mySitOutLimit sentence (the sit-out note / away banner): N, 1, protected; null / absent / 0 = no sentence', () => {
  const lim = (o) => ({ handsSatOut: 3, handsLimit: 30, handsLeft: 27, protectedUntil: null, ...o });
  assert.equal(S.sitOutLimitSentence(lim(), NOW), 'Come back within 27 hands or you will be removed.');
  assert.equal(S.sitOutLimitSentence(lim({ handsSatOut: 12, handsLeft: 18 }), NOW), 'Come back within 18 hands or you will be removed.');
  assert.equal(S.sitOutLimitSentence(lim({ handsSatOut: 29, handsLeft: 1 }), NOW), 'Come back this hand or you will be removed.');
  assert.equal(S.sitOutLimitSentence(lim({ handsLeft: undefined, handsSatOut: 28 }), NOW), 'Come back within 2 hands or you will be removed.');
  assert.equal(S.sitOutLimitSentence(lim({ protectedUntil: LATER }), NOW), 'If you are still away when late entry closes, you will be removed.');
  assert.equal(S.sitOutLimitSentence(lim({ protectedUntil: LATER }), LATER), 'Come back within 27 hands or you will be removed.');
  for (const none of [null, undefined, {}, lim({ handsSatOut: 0 }), lim({ handsSatOut: -1 }), lim({ handsSatOut: 'x' }), [], 'x']) {
    assert.equal(S.sitOutLimitSentence(none, NOW), '', JSON.stringify(none));
  }
  assert.deepEqual(S.readSitOutLimit(lim()), { handsSatOut: 3, handsLimit: 30, handsLeft: 27, protectedUntil: null });
  assert.equal(S.readSitOutLimit(null), null);
});

test('timeout toast: today\'s text word for word unless the table\'s server enforces the limit', () => {
  assert.equal(S.timeoutSitOutText(false), "Your time ran out, so you're sitting out. Tap I'm back to play again.");
  assert.equal(S.timeoutSitOutText(true),
    "Your time ran out, so you're sitting out. Tap I'm back to play again. You can't sit out more than 30 hands in a row.");
  assert.ok(S.timeoutSitOutText(true).startsWith("Your time ran out, so you're sitting out."), 'the 98397e0 lock token leads');
  assert.equal(S.sitOutLimitEnforcedAt({ tableId: 't', mySitOutLimit: null }), true, 'a FIX 2 server always sends the key');
  assert.equal(S.sitOutLimitEnforcedAt({ tableId: 't', mySitOutLimit: { handsSatOut: 1 } }), true);
  assert.equal(S.sitOutLimitEnforcedAt({ tableId: 't' }), false, 'an older server never does');
  assert.equal(S.sitOutLimitEnforcedAt(null), false);
});

test('removal: only reason sat_out_limit (never the cash sit_out_limit); bust banner, own, elsewhere, room and lobby lines', () => {
  const rm = { tournamentId: 't1', position: 7, totalPlayers: 40, reason: 'sat_out_limit', handsSatOut: 30 };
  assert.equal(S.satOutRemovedHands(rm), 30);
  assert.equal(S.satOutRemovedHands({ ...rm, handsSatOut: undefined }), 30);
  assert.equal(S.satOutRemovedHands({ ...rm, reason: 'sit_out_limit' }), null, 'the cash reason is not a tournament removal');
  assert.equal(S.satOutRemovedHands({ position: 7 }), null, 'a bust');
  assert.equal(S.satOutRemovedHands(null), null);
  assert.equal(S.bustBannerRemovalLine(rm), 'Removed for sitting out 30 hands in a row.');
  assert.equal(S.bustBannerRemovalLine({ position: 7, totalPlayers: 40 }), null, 'a bust: no reason line');
  assert.equal(S.satOutRemovedOwnLine('Weekly Qualifier', 7, 30),
    'Weekly Qualifier: you were removed for sitting out 30 hands in a row and finished in position 7.');
  assert.equal(S.satOutRemovedOwnLine(null, 7, 30),
    'Your tournament: you were removed for sitting out 30 hands in a row and finished in position 7.');
  assert.equal(S.satOutRemovedOwnLine(null, null, 30), 'Your tournament: you were removed for sitting out 30 hands in a row.');
  // The lobby banner's line (store/tournamentSeatStore passes its own default name).
  assert.equal(S.satOutRemovedOwnLine('', 12, 30, 'your tournament'),
    'your tournament: you were removed for sitting out 30 hands in a row and finished in position 12.');
  assert.equal(S.satOutRemovedElsewhereText(7, 30),
    'Your tournament has ended: you were removed for sitting out 30 hands in a row and finished in position 7.');
  assert.equal(S.satOutRemovedElsewhereText(undefined, 30), 'Your tournament has ended: you were removed for sitting out 30 hands in a row.');
  assert.equal(S.satOutRemovedRoomText('Bo', 7), 'Bo removed for sitting out (7th)');
  assert.equal(S.satOutRemovedRoomText('Bo', 21), 'Bo removed for sitting out (21st)');
  assert.equal(S.satOutRemovedRoomText('Bo', 12), 'Bo removed for sitting out (12th)');
  assert.equal(S.satOutRemovedRoomText(null, 3, true), 'You were removed for sitting out (3rd)');
  assert.equal(S.satOutRemovedRoomText('Bo', null), 'Bo removed for sitting out');
  assert.equal(S.satOutRemovedRoomText(null, null, true), 'You were removed for sitting out');
});

// Review fix (2026-11-26): the owner's order removes an Online League no-show
// still away when late entry closes at the first hand end after it, WHATEVER
// his count. That removal carries noShow: true and says why; a hand count
// ("30", or his real 22) would not.
test('removal of a league no-show when late entry closes (noShow): says why, never a hand count; control: 30-hand wording', () => {
  const ns = { tournamentId: 'ol1', position: 9, totalPlayers: 20, reason: 'sat_out_limit', handsSatOut: 22, noShow: true };
  assert.equal(S.satOutRemovedNoShow(ns), true);
  assert.equal(S.NO_SHOW_REMOVED_TEXT, 'Removed because you were still away when late entry closed.');
  assert.equal(S.bustBannerRemovalLine(ns), 'Removed because you were still away when late entry closed.');
  assert.equal(S.satOutRemovedOwnLine('Online League - Sat, Nov 28', 9, S.satOutRemovedHands(ns), undefined, S.satOutRemovedNoShow(ns)),
    'Online League - Sat, Nov 28: you were removed because you were still away when late entry closed, and finished in position 9.');
  assert.equal(S.satOutRemovedOwnLine(null, null, 22, undefined, true),
    'Your tournament: you were removed because you were still away when late entry closed.');
  assert.equal(S.satOutRemovedOwnLine('', 9, 22, 'your tournament', true),
    'your tournament: you were removed because you were still away when late entry closed, and finished in position 9.');
  assert.equal(S.satOutRemovedElsewhereText(9, 22, true),
    'Your tournament has ended: you were removed because you were still away when late entry closed, and finished in position 9.');
  assert.equal(S.satOutRemovedElsewhereText(undefined, 22, true),
    'Your tournament has ended: you were removed because you were still away when late entry closed.');
  for (const s of [S.bustBannerRemovalLine(ns), S.satOutRemovedOwnLine('Q', 9, 22, undefined, true), S.satOutRemovedElsewhereText(9, 22, true)]) {
    assert.doesNotMatch(s, /\d+ hands? in a row/, `no hand count: ${s}`);
    assert.ok(ASCII.test(s), `ASCII: ${s}`);
    assert.doesNotMatch(s, NEVER, s);
  }
  // CONTROL: the same payload without noShow (or noShow not exactly true) is the 30-hand removal, word for word as before.
  for (const not of [{ ...ns, noShow: undefined, handsSatOut: 30 }, { ...ns, noShow: 'true', handsSatOut: 30 }, { ...ns, noShow: 1, handsSatOut: 30 }]) {
    assert.equal(S.satOutRemovedNoShow(not), false, JSON.stringify(not));
    assert.equal(S.bustBannerRemovalLine(not), 'Removed for sitting out 30 hands in a row.');
  }
  assert.equal(S.satOutRemovedOwnLine('Weekly Qualifier', 7, 30), 'Weekly Qualifier: you were removed for sitting out 30 hands in a row and finished in position 7.');
  assert.equal(S.satOutRemovedOwnLine('Weekly Qualifier', 7, 30, undefined, false), 'Weekly Qualifier: you were removed for sitting out 30 hands in a row and finished in position 7.');
  assert.equal(S.satOutRemovedElsewhereText(7, 30, false), 'Your tournament has ended: you were removed for sitting out 30 hands in a row and finished in position 7.');
  // noShow never turns a BUST (or the cash reason) into a removal.
  assert.equal(S.satOutRemovedNoShow({ position: 9, noShow: true }), false);
  assert.equal(S.bustBannerRemovalLine({ position: 9, noShow: true }), null);
  assert.equal(S.satOutRemovedNoShow({ reason: 'sit_out_limit', noShow: true }), false);
  assert.equal(S.satOutRemovedNoShow(null), false);
});

// Review fix (2026-11-26): a player removed while AWAY whose tournament then
// finished is told at his next sign-in by 'tournamentFinishedForEntrant'
// {tournamentId, position, prize?, tournamentName, atSignIn: true, reason:
// 'sat_out_limit', handsSatOut, noShow?} (poker-server tellRemovalSignInNotices
// / tellUnseenTournamentResults). The toast said only "<name> has finished: you
// placed 31st." - never why. It now says removed, in the playerEliminated words.
test('finished-for-entrant at sign-in: a removal says why (30 hands / no-show); CONTROL: no reason = null, today\'s finished text', () => {
  const fin = { tournamentId: 'wq1', position: 31, tournamentName: 'Weekly Qualifier - Nov 29', atSignIn: true, reason: 'sat_out_limit', handsSatOut: 30 };
  assert.equal(S.finishedForEntrantRemovalLine(fin, fin.tournamentName),
    'Weekly Qualifier - Nov 29: you were removed for sitting out 30 hands in a row and finished in position 31.');
  // The same words as the playerEliminated direct / sign-in notice (satOutRemovedOwnLine).
  assert.equal(S.finishedForEntrantRemovalLine(fin, 'Q'), S.satOutRemovedOwnLine('Q', 31, 30, undefined, false));
  assert.equal(S.finishedForEntrantRemovalLine({ ...fin, handsSatOut: undefined }, 'Q'),
    'Q: you were removed for sitting out 30 hands in a row and finished in position 31.', 'count not sent: the limit');
  assert.equal(S.finishedForEntrantRemovalLine(fin, null),
    'Your tournament: you were removed for sitting out 30 hands in a row and finished in position 31.', 'no name');
  assert.equal(S.finishedForEntrantRemovalLine(fin, '  '),
    'Your tournament: you were removed for sitting out 30 hands in a row and finished in position 31.', 'blank name');
  assert.equal(S.finishedForEntrantRemovalLine({ ...fin, position: null }, 'Q'),
    'Q: you were removed for sitting out 30 hands in a row.', 'place unknown');
  assert.equal(S.finishedForEntrantRemovalLine({ ...fin, position: 0 }, 'Q'),
    'Q: you were removed for sitting out 30 hands in a row.', 'place 0 is not a place');
  // An Online League no-show removed when late entry closed: why, never a hand count.
  const ns = { ...fin, tournamentId: 'ol1', tournamentName: 'Online League - Sat, Nov 28', position: 9, handsSatOut: 22, noShow: true };
  assert.equal(S.finishedForEntrantRemovalLine(ns, ns.tournamentName),
    'Online League - Sat, Nov 28: you were removed because you were still away when late entry closed, and finished in position 9.');
  assert.doesNotMatch(S.finishedForEntrantRemovalLine(ns, 'Q'), /\d+ hands? in a row/);
  // noShow not exactly true: the hand-count wording.
  assert.equal(S.finishedForEntrantRemovalLine({ ...ns, noShow: 'true' }, 'Q'),
    'Q: you were removed for sitting out 22 hands in a row and finished in position 9.');
  for (const s of [S.finishedForEntrantRemovalLine(fin, 'Q'), S.finishedForEntrantRemovalLine(ns, 'Q')]) {
    assert.ok(ASCII.test(s), `ASCII: ${s}`);
    assert.doesNotMatch(s, NEVER, s);
  }
  // CONTROL: a plain finish (today's payload: no reason), the cash reason, a
  // noShow without the reason, an older server - null, so the caller keeps
  // tournamentFinishedText ("<name> has finished: you placed 31st.").
  const plain = { tournamentId: 'wq1', position: 31, prize: 270, tournamentName: 'Weekly Qualifier - Nov 29' };
  for (const not of [plain, { ...plain, atSignIn: true }, { ...fin, reason: undefined }, { ...fin, reason: 'sit_out_limit' },
    { ...plain, noShow: true }, { ...plain, handsSatOut: 30 }, null, undefined, 'sat_out_limit']) {
    assert.equal(S.finishedForEntrantRemovalLine(not, 'Weekly Qualifier - Nov 29'), null, JSON.stringify(not));
  }
});

test('away seat line (lobby Return banner): the rule, never a stale count', () => {
  assert.equal(S.awaySeatSitOutWarningLine({ tournamentId: 't1', handsSatOut: 3, handsLimit: 30, handsLeft: 27 }, NOW),
    'If you are away for 30 hands in a row, you will be removed from the tournament.');
  assert.equal(S.awaySeatSitOutWarningLine({ tournamentId: 't1', protectedUntil: LATER }, NOW),
    'If you are still away when late entry closes, you will be removed from the tournament.');
  assert.equal(S.awaySeatSitOutWarningLine(null, NOW), '');
});

test('FIX 1 short table: only tableHold short_table on a table not marked cash', () => {
  assert.equal(S.shortTableHeldOf({ isTournament: true, tableHold: 'short_table' }), true);
  assert.equal(S.shortTableHeldOf({ tableHold: 'short_table' }), true, 'unmarked (no isTournament) still says it');
  assert.equal(S.shortTableHeldOf({ isTournament: false, tableHold: 'short_table' }), false, 'a merged key never holds a cash table');
  assert.equal(S.shortTableHeldOf({ isTournament: true, tableHold: null }), false);
  assert.equal(S.shortTableHeldOf({ isTournament: true }), false, 'an older server: today\'s waiting line');
  assert.equal(S.shortTableHeldOf({ isTournament: true, tableHold: 'other' }), false);
  assert.equal(S.shortTableHeldOf(null), false);
  assert.equal(S.SHORT_TABLE_WAITING_TEXT, 'Waiting for players to be moved to this table.');
});

test('every new sentence is plain ASCII and never the cash "chips went back to your balance" / "released"', () => {
  const out = [
    S.sitOutWarningText({ handsSatOut: 3, handsLimit: 30, handsLeft: 27 }, NOW),
    S.sitOutWarningText({ handsSatOut: 29, handsLeft: 1 }, NOW),
    S.sitOutWarningText({ handsSatOut: 3, protectedUntil: LATER }, NOW),
    S.sitOutWarningText({}, NOW),
    S.sitOutLimitSentence({ handsSatOut: 3, handsLeft: 27 }, NOW),
    S.sitOutLimitSentence({ handsSatOut: 29, handsLeft: 1 }, NOW),
    S.sitOutLimitSentence({ handsSatOut: 3, protectedUntil: LATER }, NOW),
    S.timeoutSitOutText(true), S.timeoutSitOutText(false),
    S.bustBannerRemovalLine({ reason: 'sat_out_limit' }),
    S.satOutRemovedOwnLine('Q', 7, 30), S.satOutRemovedElsewhereText(7, 30),
    S.satOutRemovedRoomText('Bo', 7), S.satOutRemovedRoomText(null, 7, true),
    S.awaySeatSitOutWarningLine({}, NOW), S.awaySeatSitOutWarningLine({ protectedUntil: LATER }, NOW),
    S.SHORT_TABLE_WAITING_TEXT, S.SIT_OUT_WARNING_TITLE,
  ];
  for (const s of out) {
    assert.ok(typeof s === 'string' && s.length > 0, `empty: ${s}`);
    assert.ok(ASCII.test(s), `ASCII: ${s}`);
    assert.doesNotMatch(s, NEVER, s);
  }
  const mod = readSrc('utils/tournamentSitOut.js');
  assert.doesNotMatch(mod.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''), NEVER, 'no cash wording in the module\'s code');
  assert.doesNotMatch(mod, /^import /m, 'pure: no imports (AGENT.md rule 22)');
  assert.equal(S.TOURNAMENT_SIT_OUT_WARNING_EVENT, 'tournamentSitOutWarning');
  assert.equal(S.SAT_OUT_LIMIT_REASON, 'sat_out_limit');
});

// ── Rules copy: gated on the server's list flags (AGENT.md rule 20) ─────────

const weeklyRaw = (over = {}) => ({
  qualifierId: 'w-1129', type: 'weekly', name: 'Weekly Qualifier - Nov 29', status: 'scheduled',
  scheduledAt: '2026-11-29T18:00:00.000Z', seatsForTop: 3, lateRegClosesAtBubble: true, seedsHeldUntilEnd: true, ...over,
});
const leagueRaw = (over = {}) => ({
  qualifierId: 'ol-1128', type: 'online_league', kind: 'league', name: 'Online League - Sat, Nov 28', status: 'scheduled',
  scheduledAt: '2026-11-29T01:00:00.000Z', lateRegUntil: '2026-11-29T02:00:00.000Z', requiresCredit: false,
  leaguePoints: true, leaguePrize: 'chair_month', ...over,
});
const WEEKLY_SITOUT = "You can't sit out more than 30 hands in a row. On the 30th hand you are removed, the same as a bust: you finish in the next place.";
const WEEKLY_SHORT = 'While two or more tables are running, a table never plays with fewer than 4 players. It waits until players are moved to it.';
const LEAGUE_SITOUT = "Once you have taken your seat, you can't sit out more than 30 hands in a row. On the 30th hand you are removed and finish in the next place.";
// The approved Seating line about a new table (owner 2026-10-23), word for word.
const WEEKLY_NEW_TABLE_OLD = 'If every seat is full when someone late-registers or re-enters, a new table opens. A player alone there is not dealt in and pays no blinds. If that player is at the table, one player moves over from the fullest table so play can start. There is no limit on extra tables.';
// ... and as it reads once poker-server holds short tables (FIX 1).
const WEEKLY_NEW_TABLE_FIX1 = 'If every seat is full when someone late-registers or re-enters, a new table opens. Players move over from the other tables until it has 4, then play starts there. There is no limit on extra tables.';

test('list item: sitOutLimitHands / minTablePlayers pass through normalizeQualifierItem (null when not sent)', () => {
  const on = L.normalizeQualifierItem(weeklyRaw({ sitOutLimitHands: 30, minTablePlayers: 4 }));
  assert.equal(on.sitOutLimitHands, 30);
  assert.equal(on.minTablePlayers, 4);
  const off = L.normalizeQualifierItem(weeklyRaw());
  assert.equal(off.sitOutLimitHands, null);
  assert.equal(off.minTablePlayers, null);
  assert.equal(L.normalizeQualifierItem(weeklyRaw({ sitOutLimitHands: 'x', minTablePlayers: -4 })).sitOutLimitHands, null);
});

test('weekly rules: the two new lines only with their flags, in place, plain ASCII; dates bumped', () => {
  assert.equal(R.QUALIFIER_RULES_UPDATED, '2026-11-26');
  assert.equal(R.rulesUpdatedLine(), 'Updated Nov 26, 2026.');
  const plain = R.qualifierRulesFor(L.normalizeQualifierItem(weeklyRaw()));
  const plainLines = plain.flatMap((s) => s.rules);
  assert.equal(plainLines.includes(WEEKLY_SITOUT), false, 'no limit line from a server that does not enforce it');
  assert.equal(plainLines.includes(WEEKLY_SHORT), false, 'no short-table line from a server that does not hold');
  assert.equal(plainLines.some((l) => /in a row/.test(l)), false);
  const full = R.qualifierRulesFor(L.normalizeQualifierItem(weeklyRaw({ sitOutLimitHands: 30, minTablePlayers: 4 })));
  const disc = full.find((s) => s.heading === 'Disconnects and time to act').rules;
  assert.equal(disc[disc.length - 1], WEEKLY_SITOUT);
  const seating = full.find((s) => s.heading === 'Seating').rules;
  const newTable = seating.findIndex((l) => l.startsWith('If every seat is full'));
  assert.ok(newTable >= 0);
  assert.equal(seating[newTable + 1], WEEKLY_SHORT);
  // One flag at a time.
  const onlySit = R.qualifierRulesFor({ type: 'weekly', sitOutLimitHands: 30 }).flatMap((s) => s.rules);
  assert.ok(onlySit.includes(WEEKLY_SITOUT));
  assert.equal(onlySit.includes(WEEKLY_SHORT), false);
  const onlyShort = R.qualifierRulesFor({ type: 'weekly', minTablePlayers: 4 }).flatMap((s) => s.rules);
  assert.ok(onlyShort.includes(WEEKLY_SHORT));
  assert.equal(onlyShort.includes(WEEKLY_SITOUT), false);
  // The weekly suspension line keeps its own "removed ... no place or seat" meaning.
  assert.ok(plainLines.some((l) => /removed within a hand or two and get no place or seat/.test(l)));
  assert.ok(ASCII.test(JSON.stringify(R.QUALIFIER_RULES)), 'plain ASCII (AGENT.md rule 20)');
  // The rules page for a weekly item reads the same.
  assert.deepEqual(R.rulesPageFor(L.normalizeQualifierItem(weeklyRaw({ sitOutLimitHands: 30, minTablePlayers: 4 }))).sections, full);
});

// Review fix (2026-11-26): with FIX 1 a new (overflow) table is held until it
// has 4 alive and is filled to 4 from the other tables (poker-server: the
// overflow feed, then planShortTableFill from any table with 6+, present or
// not) - so "one player moves over from the fullest table so play can start"
// is no longer what the server does. The approved line stays word for word
// for an older server (AGENT.md rule 20: never a rule the code does not do).
test('weekly Seating: the new-table line follows FIX 1 only with minTablePlayers; control: the approved line verbatim without it', () => {
  const seatingOf = (q) => R.qualifierRulesFor(q).find((s) => s.heading === 'Seating').rules;
  // CONTROL: no flag (an older server), or only the sit-out flag -> today's approved line, word for word.
  for (const q of [L.normalizeQualifierItem(weeklyRaw()), { type: 'weekly', sitOutLimitHands: 30 }, null]) {
    const seating = seatingOf(q);
    assert.ok(seating.includes(WEEKLY_NEW_TABLE_OLD), `approved line kept: ${JSON.stringify(q)}`);
    assert.equal(seating.includes(WEEKLY_NEW_TABLE_FIX1), false);
    assert.equal(seating.includes(WEEKLY_SHORT), false);
  }
  // FIX 1 server: the new wording, then the short-table line; the old promise is gone.
  const on = seatingOf(L.normalizeQualifierItem(weeklyRaw({ sitOutLimitHands: 30, minTablePlayers: 4 })));
  const at = on.indexOf(WEEKLY_NEW_TABLE_FIX1);
  assert.ok(at >= 0, 'FIX 1 new-table line');
  assert.equal(on[at + 1], WEEKLY_SHORT);
  assert.equal(on.includes(WEEKLY_NEW_TABLE_OLD), false);
  assert.equal(on.some((l) => /one player moves over/.test(l)), false, 'no "one player moves over" with FIX 1');
  assert.equal(on.some((l) => /A player alone there is not dealt in/.test(l)), false);
  assert.equal(on.filter((l) => l.startsWith('If every seat is full')).length, 1, 'one new-table line, never both');
  // The other Seating lines are unchanged and in the same order.
  const off = seatingOf(L.normalizeQualifierItem(weeklyRaw()));
  assert.deepEqual(on.filter((l) => l !== WEEKLY_NEW_TABLE_FIX1 && l !== WEEKLY_SHORT), off.filter((l) => l !== WEEKLY_NEW_TABLE_OLD));
  assert.equal(on.length, off.length + 1);
  // The number follows the server's minTablePlayers.
  assert.ok(seatingOf({ type: 'weekly', minTablePlayers: 5 }).includes(WEEKLY_NEW_TABLE_FIX1.replace('until it has 4', 'until it has 5')));
  assert.ok(ASCII.test(WEEKLY_NEW_TABLE_FIX1));
});

test('league rules + registrant note: the removal lines / sentence only with sitOutLimitHands; never "released"', () => {
  const off = R.rulesPageFor(L.normalizeQualifierItem(leagueRaw()));
  assert.equal(off.updated, 'Updated Nov 26, 2026.');
  assert.equal(off.sections.flatMap((s) => s.rules).some((l) => /removed|in a row/i.test(l)), false);
  const on = R.rulesPageFor(L.normalizeQualifierItem(leagueRaw({ sitOutLimitHands: 30, minTablePlayers: 4 })));
  const lines = on.sections.flatMap((s) => s.rules);
  assert.ok(lines.includes('If you are still away when late entry closes at 7:00 PM MT, you are removed and finish in the next place.'));
  assert.ok(lines.includes(LEAGUE_SITOUT));
  // Review fix: a registrant who never arrived is protected until 7:00 PM MT,
  // so the page never says that NOBODY can sit out more than 30 in a row.
  assert.equal(lines.some((l) => /^Nobody can sit out/.test(l)), false);
  assert.equal(lines.includes(WEEKLY_SHORT), false, 'the short-table line is the weekly page\'s');
  assert.doesNotMatch(JSON.stringify(on.sections), /released/i);
  const qOff = L.normalizeQualifierItem(leagueRaw());
  assert.equal(L.qualifierBeOnlineText(qOff), 'Be on americanpubpoker.online by 6:00 PM MT. Anyone not here when it starts is still seated and blinded out until they arrive.');
  const qOn = L.normalizeQualifierItem(leagueRaw({ sitOutLimitHands: 30 }));
  assert.equal(L.qualifierBeOnlineText(qOn),
    'Be on americanpubpoker.online by 6:00 PM MT. Anyone not here when it starts is still seated and blinded out until they arrive. Anyone still away when late entry closes is removed.');
  assert.equal(L.qualifierBeOnlineText({ ...qOn, scheduledAt: null }),
    'Be on americanpubpoker.online at the start. Anyone not here when it starts is still seated and blinded out until they arrive. Anyone still away when late entry closes is removed.');
  assert.doesNotMatch(L.qualifierBeOnlineText(qOn), /released|refund/);
  // The weekly note is unchanged by the flag.
  assert.equal(L.qualifierBeOnlineText(L.normalizeQualifierItem(weeklyRaw({ sitOutLimitHands: 30 }))),
    'Be on americanpubpoker.online by 11:00 AM MT — anyone not here when it starts is released and the credit refunded.');
});

// ── Static guards on the JSX (no React renderer in node) ────────────────────

const APP = readSrc('App.jsx');
const HUD = readSrc('components/game/GameHUD.jsx');
const SEAT_STORE = readSrc('store/tournamentSeatStore.js');
const NOTICE = readSrc('components/ui/TournamentSeatNotice.jsx');

function between(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `marker: ${to}`);
  return src.slice(a, b);
}

function hexColors(src) {
  return [...src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => {
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const n = parseInt(hex, 16);
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

// JSX / JS comments out (a comment saying "never red" is not a colour).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function assertNoRedOrAmber(seg, label) {
  const code = stripComments(seg);
  for (const c of hexColors(code)) {
    const coloured = c.s >= 0.3 && c.l >= 0.1 && c.l <= 0.95;
    assert.ok(!(coloured && isRedHue(c.h)), `${label}: no red ${c.text}`);
    assert.ok(!(coloured && c.h >= 20 && c.h < 42), `${label}: no orange / amber ${c.text}`);
  }
  assert.doesNotMatch(code, /rgba\(\s*245\s*,\s*158\s*,\s*11/, `${label}: no amber rgba`);
  assert.doesNotMatch(code, /\bred\b/i, `${label}: no red`);
  assert.doesNotMatch(code, /afk-warning-banner/, `${label}: never the amber warning banner`);
  assert.doesNotMatch(code, /type:\s*'warn'|'warn'\)/, `${label}: never a warn toast`);
}

test('App: the warning listener is registered and removed by its handler ref; system toast titled Sitting out', () => {
  const handler = between(APP, 'const handleTournamentSitOutWarning = (data) => {', 'socket.on(TOURNAMENT_SIT_OUT_WARNING_EVENT, handleTournamentSitOutWarning);');
  assert.match(handler, /sitOutWarningText\(data, now\)/);
  assert.match(handler, /noteAwaySeatSitOutWarning\(data, now\)/);
  assert.match(handler, /type: 'system', title: SIT_OUT_WARNING_TITLE/);
  assertNoRedOrAmber(handler, 'warning handler');
  const on = APP.indexOf('socket.on(TOURNAMENT_SIT_OUT_WARNING_EVENT, handleTournamentSitOutWarning);');
  const cleanup = APP.indexOf("socket.off('sitOutToggled');");
  const off = APP.indexOf('socket.off(TOURNAMENT_SIT_OUT_WARNING_EVENT, handleTournamentSitOutWarning);');
  assert.ok(on > 0 && cleanup > on && off > cleanup, 'off in the same effect\'s cleanup, after the on');
  assert.equal(APP.split('socket.on(TOURNAMENT_SIT_OUT_WARNING_EVENT').length - 1, 1, 'registered once');
  assert.doesNotMatch(APP, /socket\.on\('tournamentSitOutWarning'/, 'by the shared constant');
});

test('App: timeout toast gated on the table\'s mySitOutLimit key; elimination toasts carry the removal wording', () => {
  const sit = between(APP, "socket.on('sitOutToggled', (data) => {", '// 2026-11-26 (owner orders 2026-11-25, FIX 2) — poker-server warns ONCE');
  assert.match(sit, /type: 'system', title: 'Sitting out'/);
  assert.match(sit, /message: timeoutSitOutText\(limitOn\)/);
  assert.match(sit, /sitOutLimitEnforcedAt\(entry && entry\.gameState\) \|\| sitOutLimitEnforcedAt\(tsT\.gameState\)/);
  assertNoRedOrAmber(sit, 'sitOutToggled');
  const elsewhere = between(APP, 'const handleEliminatedToSpectator = (data) => {', "socket.on('eliminatedToSpectator', handleEliminatedToSpectator);");
  assert.match(elsewhere, /reason: data\?\.reason, handsSatOut: data\?\.handsSatOut, noShow: data\?\.noShow/, 'the lobby line gets the reason (+ noShow)');
  assert.match(elsewhere, /removedHands \? satOutRemovedElsewhereText\(data\?\.position, removedHands, satOutRemovedNoShow\(data\)\)/);
  assert.match(elsewhere, /`Your tournament has ended: you finished in position \$\{pos\}\.`/, 'a bust reads as today');
  const elim = between(APP, "socket.on('playerEliminated', (data) => {", "Round 6 (P-h') — the finished notice");
  assert.match(elim, /const removedHands = satOutRemovedHands\(data\);/);
  assert.match(elim, /satOutRemovedOwnLine\(name, data\?\.position, removedHands, undefined, satOutRemovedNoShow\(data\)\)\}\$\{prizeSuffix\(data\?\.prize\)\}/, 'direct / sign-in: + the prize');
  assert.match(elim, /reason: data\.reason, handsSatOut: data\.handsSatOut, noShow: data\.noShow/, 'the away seat\'s lobby line gets the reason (+ noShow)');
  assert.match(elim, /satOutRemovedRoomText\(null, data\?\.position, true\)/, 'his own room copy');
  assert.match(elim, /satOutRemovedRoomText\(data\.playerName, data\.position\)/, 'the room copy');
  assert.match(elim, /`You were eliminated \(\$\{pos\}\$\{getOrdinal\(pos\)\}\)`/, 'a bust reads as today');
  assert.match(elim, /`\$\{data\.playerName\} eliminated \(\$\{data\.position\}\$\{getOrdinal\(data\.position\)\}\)`/);
  for (const [seg, label] of [[elsewhere, 'eliminatedToSpectator'], [elim, 'playerEliminated']]) assertNoRedOrAmber(seg, label);
});

test('tournamentSeatStore + Return banner: lobby end line says removed; an away seat shows the warning line', () => {
  assert.match(SEAT_STORE, /export function noteTournamentOver\(\{ tournamentId, tableId, position, finished, room = false, reason, handsSatOut, noShow \} = \{\}\)/);
  assert.match(SEAT_STORE, /satOutRemovedOwnLine\(name, pos, removedHands, DEFAULT_NAME, satOutRemovedNoShow\(\{ reason, noShow \}\)\)/);
  assert.match(SEAT_STORE, /`\$\{name\}: you finished in position \$\{pos\}\.`/, 'a bust reads as today');
  assert.match(SEAT_STORE, /export function noteAwaySeatSitOutWarning\(data, now = Date\.now\(\)\)/);
  assert.match(SEAT_STORE, /if \(a\.tournamentId !== t\) return a;/, 'Z8: matched by tournamentId only');
  assert.match(SEAT_STORE, /sitOutWarning: \(prev && prev\.sitOutWarning\) \|\| null/, 'kept through a rebalance / sign-in update');
  const line = between(NOTICE, '{a.sitOutWarning ? (', ') : null}');
  assert.match(line, /className="tournament-return-sitout-limit"/);
  assertNoRedOrAmber(line, 'Return banner line');
});

// Review fix (2026-11-26): the sign-in 'tournamentFinishedForEntrant' of a
// removed player carries the reason; App passes it, and the store's lobby line
// lets the reason win over `finished`.
test('App: tournamentFinishedForEntrant toasts the removal line and passes the reason to the lobby line; CONTROL: today\'s finished text', () => {
  const fin = between(APP, 'const handleTournamentFinishedForEntrant = (data) => {', "socket.on('tournamentFinishedForEntrant', handleTournamentFinishedForEntrant);");
  assert.match(fin, /noteTournamentOver\(\{ tournamentId: tid, finished: true, position: place, reason: data\?\.reason, handsSatOut: data\?\.handsSatOut, noShow: data\?\.noShow \}\)/);
  assert.match(fin, /const removedLine = finishedForEntrantRemovalLine\(data, name\);/);
  assert.match(fin, /message: \(removedLine \|\| tournamentFinishedText\(name, place\)\) \+ prizeSuffix\(prize\),/, 'removal line, else today\'s text; + the prize either way');
  assert.equal((stripComments(fin).match(/addNotification\(/g) || []).length, 1, 'still one toast');
  assertNoRedOrAmber(fin, 'tournamentFinishedForEntrant');
  assert.match(APP, /satOutRemovedRoomText, finishedForEntrantRemovalLine,\n\} from '\.\/utils\/tournamentSitOut';/);
  // The room's finish frame is untouched: no reason there.
  assert.match(APP, /noteTournamentOver\(\{ tournamentId: data\?\.tournamentId, finished: true, position: myPlace, room: true \}\)/);
  assert.match(SEAT_STORE, /const removedHands = satOutRemovedHands\(\{ reason, handsSatOut \}\);\n\s*if \(removedHands\) \{/, 'the reason is read whatever `finished` says');
});

test('lobby line (the REAL tournamentSeatStore): a finished notice with the removal reason says removed; CONTROL: a plain finish reads as today', async () => {
  const STORE = await import(new URL('store/tournamentSeatStore.js', SRC_DIR).href);
  const warn = console.warn;
  console.warn = () => {};
  const keep = (tid, name) => {
    STORE.resetTournamentSeat();
    STORE.noteTournamentSeatKept({ tournamentId: tid, tableId: `tb-${tid}`, seatIndex: 3, tournamentName: name });
    assert.equal(STORE.useTournamentSeatStore.getState().awaySeats.length, 1, 'away seat kept');
  };
  const notice = () => STORE.useTournamentSeatStore.getState().notice;
  try {
    // The fix: finished + reason 'sat_out_limit'.
    keep('wq1', 'Weekly Qualifier - Nov 29');
    assert.equal(STORE.noteTournamentOver({ tournamentId: 'wq1', finished: true, position: 31, reason: 'sat_out_limit', handsSatOut: 30 }), true);
    assert.equal(notice(), 'Weekly Qualifier - Nov 29: you were removed for sitting out 30 hands in a row and finished in position 31.');
    assert.equal(STORE.useTournamentSeatStore.getState().noticeKind, 'finished');
    assert.equal(STORE.useTournamentSeatStore.getState().awaySeats.length, 0, 'the seat ended');
    keep('ol1', 'Online League - Sat, Nov 28');
    STORE.noteTournamentOver({ tournamentId: 'ol1', finished: true, position: 9, reason: 'sat_out_limit', handsSatOut: 22, noShow: true });
    assert.equal(notice(), 'Online League - Sat, Nov 28: you were removed because you were still away when late entry closed, and finished in position 9.');
    // The same words the toast uses (one place, one wording).
    assert.equal(notice(), S.finishedForEntrantRemovalLine({ position: 9, reason: 'sat_out_limit', handsSatOut: 22, noShow: true }, 'Online League - Sat, Nov 28'));
    // CONTROL: a plain finish (today's per-entrant notice, the room's frame) - today's words.
    keep('wq1', 'Weekly Qualifier - Nov 29');
    STORE.noteTournamentOver({ tournamentId: 'wq1', finished: true, position: 31 });
    assert.equal(notice(), 'Weekly Qualifier - Nov 29 has finished: you placed 31st.');
    keep('wq1', 'Weekly Qualifier - Nov 29');
    STORE.noteTournamentOver({ tournamentId: 'wq1', finished: true, position: 31, room: true });
    assert.equal(notice(), 'Weekly Qualifier - Nov 29 has finished: you placed 31st.');
    // CONTROL: the cash reason is never a tournament removal.
    keep('wq1', 'Weekly Qualifier - Nov 29');
    STORE.noteTournamentOver({ tournamentId: 'wq1', finished: true, position: 31, reason: 'sit_out_limit', handsSatOut: 30 });
    assert.equal(notice(), 'Weekly Qualifier - Nov 29 has finished: you placed 31st.');
    // Unchanged: a bust, and a removal while the tournament still runs.
    keep('wq1', 'Weekly Qualifier - Nov 29');
    STORE.noteTournamentOver({ tournamentId: 'wq1', position: 31 });
    assert.equal(notice(), 'Weekly Qualifier - Nov 29: you finished in position 31.');
    keep('wq1', 'Weekly Qualifier - Nov 29');
    STORE.noteTournamentOver({ tournamentId: 'wq1', position: 31, reason: 'sat_out_limit', handsSatOut: 30 });
    assert.equal(notice(), 'Weekly Qualifier - Nov 29: you were removed for sitting out 30 hands in a row and finished in position 31.');
    // Another tournament's notice never writes over this seat (Z8).
    keep('wq1', 'Weekly Qualifier - Nov 29');
    assert.equal(STORE.noteTournamentOver({ tournamentId: 'other', finished: true, position: 2, reason: 'sat_out_limit', handsSatOut: 30 }), false);
    assert.equal(notice(), null);
    assert.equal(STORE.useTournamentSeatStore.getState().awaySeats.length, 1);
  } finally {
    console.warn = warn;
    STORE.resetTournamentSeat();
  }
});

test('GameHUD: sit-out note + AFK banner add the sentence; classes kept for APP Precision placement', () => {
  assert.match(HUD, /const sitOutLimitLine = onTournamentSeat \? sitOutLimitSentence\(gameState\?\.mySitOutLimit, serverNow\(\)\) : '';/);
  const banners = between(HUD, '{/* AFK "You\'re Away" indicator.', '{/* Missed Blinds Button');
  const afk = between(banners, '{isAFK && (', '{onTournamentSeat && sittingOutHere && !isAFK && (');
  const note = between(banners, '{onTournamentSeat && sittingOutHere && !isAFK && (', "}}>I'm back</button>\n        </div>\n      )}");
  assert.match(afk, /className=\{`afk-away-banner\$\{onTournamentSeat \? ' afk-away-banner--tournament' : ''\}`\}/);
  assert.match(afk, /\{onTournamentSeat && sitOutLimitLine \? <> <span className="tournament-sitout-limit">\{sitOutLimitLine\}<\/span><\/> : null\}/);
  assert.match(note, /className="afk-away-banner afk-away-banner--tournament tournament-sitout-note" role="status"/);
  assert.match(note, /\{sitOutLimitLine \? <> <span className="tournament-sitout-limit">\{sitOutLimitLine\}<\/span><\/> : null\}/);
  // The sentence sits INSIDE the note's text span (the skin's direct-child span:nth-child(2) rule).
  const textSpan = between(note, '<span>🪑</span>', '<button className="afk-back-btn"');
  assert.match(textSpan, /^<span>🪑<\/span>\s*<span>\s*\{`Sitting out — you stay dealt in: your blinds are posted and \$\{TOURNAMENT_SEAT_AWAY_ACTS_TEXT\}\.`\}/);
  assert.equal((textSpan.match(/<\/span>\s*\n\s*\{\/\* Review \(round 7\)/g) || []).length, 1, 'one text span, then the button');
  assertNoRedOrAmber(banners, 'away / sit-out banners');
});

test('GameHUD: the bust banner says removed for sitting out; a bust banner is unchanged', () => {
  assert.match(HUD, /prize: data\.prize, reason: data\.reason, handsSatOut: data\.handsSatOut, noShow: data\.noShow \}\);/);
  const bust = between(HUD, '{/* Eliminated banner */}', '{/* Tournament spectator controls */}');
  assert.match(bust, /\{bustBannerRemovalLine\(eliminatedPosition\) \? \(\s*<span className="tournament-bust-reason" style=\{\{ display: 'block' \}\}>\s*\{bustBannerRemovalLine\(eliminatedPosition\)\}/);
  assert.match(bust, /out of \{eliminatedPosition\.totalPlayers\} players/);
  assertNoRedOrAmber(bust, 'bust banner');
});

test('GameHUD: a held short table says so and offers no Deal now; the tournament clock is not used for it', () => {
  assert.match(HUD, /const shortTableHeld = shortTableHeldOf\(gameState\);/);
  const wait = between(HUD, ') : isWaiting ? (', ') : hasDrawPhase && isDrawPhase ? (');
  assert.match(wait, /\{shortTableHeld \? SHORT_TABLE_WAITING_TEXT : \(phase === 'HandComplete' \? 'Starting next hand…' : 'Waiting for players…'\)\}/);
  const deal = between(wait, '{!tournamentHeld && !shortTableHeld && (', 'Deal now');
  assert.match(deal, /onClick=\{startHand\}/);
  assert.equal((stripComments(wait).match(/Deal now/g) || []).length, 1, 'one Deal now button, behind both holds');
  assertNoRedOrAmber(wait, 'waiting area');
  assert.doesNotMatch(readSrc('utils/tournamentClock.js'), /short_table/, 'FIX 1 never routes through the tournament clock');
});

test('canonical-features: every new event / visible string is locked and is a literal in src', () => {
  const tokens = [
    'tournamentSitOutWarning',
    'sat_out_limit',
    "You can't sit out more than",
    'You have sat out',
    'hands or you will be removed from the tournament.',
    'Come back this hand or you will be removed.',
    'If you are still away when late entry closes, you will be removed.',
    'Removed for sitting out',
    ': you were removed for sitting out',
    'You were removed for sitting out',
    'tournament-sitout-limit',
    'tournament-bust-reason',
    'tournament-return-sitout-limit',
    'Waiting for players to be moved to this table.',
    'Anyone still away when late entry closes is removed.',
    'hand you are removed, the same as a bust: you finish in the next place.',
    'a table never plays with fewer than {minTablePlayers} players. It waits until players are moved to it.',
    'If you are still away when late entry closes at 7:00 PM MT, you are removed and finish in the next place.',
    'hand you are removed and finish in the next place.',
    // Review fixes 2026-11-26.
    'Players move over from the other tables until it has {minTablePlayers}, then play starts there.',
    "Once you have taken your seat, you can't sit out more than",
    'because you were still away when late entry closed',
  ];
  const lines = new Set(CANON.split(/\r?\n/));
  const all = ['utils/tournamentSitOut.js', 'App.jsx', 'components/game/GameHUD.jsx', 'components/ui/TournamentSeatNotice.jsx',
    'utils/qualifierList.js', 'content/qualifierRules.js', 'content/onlineLeagueRules.js'].map(readSrc).join('\n');
  for (const t of tokens) {
    assert.ok(lines.has(t), `canonical-features.txt lacks: ${t}`);
    assert.ok(all.includes(t), `not a literal in src: ${t}`);
  }
  // The earlier locks stay.
  for (const keep of ["Your time ran out, so you're sitting out.", 'tournament-sitout-note', 'afk-away-banner--tournament',
    'is still seated and blinded out until they arrive', 'you are still seated and blinded out.']) {
    assert.ok(lines.has(keep), `lock kept: ${keep}`);
  }
});
