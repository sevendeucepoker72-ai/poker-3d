// P1-C8 player-app guardrails for the qualifier broadcast (owner 2026-11-02:
// stream the qualifiers): voice off at qualifier tables, no Go Live URL for a
// seated qualifier player, the "Show me as Player on broadcasts" opt-out, the
// approved rules lines, Terms / Privacy, the hardened ?overlay= graphic.
// node:test, no dependency; loads the REAL modules. (Moved from the scratchpad
// probes into tests/broadcast/ with P3-C10, as the lead spec says.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC_DIR = new URL('../../src/', import.meta.url);
const H = await import(new URL('utils/qualifierHelpTools.js', SRC_DIR).href);
const R = await import(new URL('content/qualifierRules.js', SRC_DIR).href);
const readSrc = (rel) => fs.readFileSync(new URL(rel, SRC_DIR), 'utf8');

// The same fixture set helpToolsOffAt is judged on (rule 19): every way a
// table is, or is not, a qualifier table.
const KNOWN = new Set(['t-known-q']);
const FIXTURES = [
  { name: 'cash table', gs: { tableId: 'c1', tableKind: 'cash', isTournament: false, tournamentId: null }, q: false },
  { name: 'plain tournament (Sit & Go)', gs: { tableId: 's1', isTournament: true, tournamentId: 't-sng', tableName: 'Sit & Go 9' }, q: false },
  { name: 'server flag isQualifier', gs: { tableId: 'q1', isQualifier: true }, q: true },
  { name: 'server qualifierId', gs: { tableId: 'q2', qualifierId: 'abc' }, q: true },
  { name: 'tableKind qualifier', gs: { tableId: 'q3', tableKind: 'qualifier' }, q: true },
  { name: 'known qualifier tournament id', gs: { tableId: 'q4', isTournament: true, tournamentId: 't-known-q' }, q: true },
  { name: 'clock paidPlaces', gs: { tableId: 'q5', isTournament: true, tournamentId: 't-x', tournamentClock: { paidPlaces: 3 } }, q: true },
  { name: 'clock seatsForTop', gs: { tableId: 'q6', isTournament: true, tournamentId: 't-y', tournamentClock: { seatsForTop: 10 } }, q: true },
  { name: 'table name Qualifier Table 2', gs: { tableId: 'q7', isTournament: true, tournamentId: 't-z', tableName: 'Qualifier Table 2' }, q: true },
  { name: 'tournament name says qualifier', gs: { tableId: 'q8', tableKind: 'tournament', tournamentId: 't-w', tournamentName: 'Weekly Qualifier' }, q: true },
  { name: 'qualifier word on a CASH table name (not a tournament)', gs: { tableId: 'c2', tableKind: 'cash', tableName: 'Qualifier practice' }, q: false },
];

test('voiceOffAt agrees with helpToolsOffAt on every fixture (no voiceChatAllowed key)', () => {
  for (const f of FIXTURES) {
    assert.equal(H.helpToolsOffAt(f.gs, KNOWN), f.q, `helpToolsOffAt ${f.name}`);
    assert.equal(H.voiceOffAt(f.gs, KNOWN), f.q, `voiceOffAt ${f.name}`);
  }
});

test('voiceOffAt honours the server key voiceChatAllowed, fail-closed', () => {
  // The server says off: off, even on a table the client cannot prove is a qualifier's.
  assert.equal(H.voiceOffAt({ tableId: 'c1', tableKind: 'cash', voiceChatAllowed: false }, KNOWN), true);
  // The server says allowed at a cash table: on.
  assert.equal(H.voiceOffAt({ tableId: 'c1', tableKind: 'cash', voiceChatAllowed: true }, KNOWN), false);
  // The server says allowed but the table IS a qualifier's by the client's evidence: still off.
  assert.equal(H.voiceOffAt({ tableId: 'q1', isQualifier: true, voiceChatAllowed: true }, KNOWN), true);
  // Junk never throws and is never "off".
  for (const junk of [null, undefined, 0, 'x', [], [{ isQualifier: true }]]) assert.equal(H.voiceOffAt(junk, KNOWN), false);
});

test('voice-off refusal frames are recognised; other codes are not', () => {
  assert.equal(H.isVoiceOffRefusal({ tableId: 'q1', code: 'voice_off_qualifier', message: 'Voice chat is off in qualifier tournaments.' }), true);
  assert.equal(H.isVoiceOffRefusal({ code: 'voice_off_qualifier' }), true);
  assert.equal(H.isVoiceOffRefusal({ code: 'help_tools_off_qualifier' }), false);
  assert.equal(H.isVoiceOffRefusal(null), false);
  assert.equal(H.VOICE_OFF_CODE, 'voice_off_qualifier');
});

// Review 2026-11-02 — poker-server's real frames: voiceForcedOff names the
// QUALIFIER table (index.ts forceVoiceOffAtQualifierTable), voiceRefused names
// the table he tried (refuseVoiceAtQualifier), which can be a CASH table when
// the socket plays a qualifier elsewhere (socketAtQualifierTable).
const CASH = { tableId: 'cash-1', tableKind: 'cash', isTournament: false, voiceChatAllowed: true };
const QUAL = { tableId: 'qual-1', isQualifier: true, qualifierId: 'wq1', voiceChatAllowed: false };
const FORCED = { code: 'voice_off_qualifier', tableId: 'qual-1', message: 'Voice chat is off in qualifier tournaments.' };
const REFUSED_AT_CASH = { tableId: 'cash-1', code: 'voice_off_qualifier', message: 'Voice chat is off in qualifier tournaments.' };

test('voiceForcedOff naming the qualifier while a CASH table is on screen still remounts VoiceChat (stops the mic)', () => {
  const a = H.voiceOffEventAction(FORCED);
  assert.equal(a.remount, true, 'the old VoiceChat unmounts: leaveVoice stops the mic');
  assert.equal(a.refusedTableId, 'qual-1');
  // The cash table on screen keeps its Voice Chat button (only the mic session ended).
  assert.deepEqual(H.voiceOffState(CASH, a.refusedTableId, KNOWN), { off: false, note: null });
  assert.equal(H.voiceOffEventAction({ tableId: 'x', code: 'something_else' }), null, 'other frames are ignored');
  assert.deepEqual(H.voiceOffEventAction(undefined), { remount: true, refusedTableId: null });
});

test('a voiceJoin refused at a CASH table (he plays a qualifier elsewhere) says so in its own words, not "qualifier tables"', () => {
  const a = H.voiceOffEventAction(REFUSED_AT_CASH);
  assert.equal(a.remount, true);
  const s = H.voiceOffState(CASH, a.refusedTableId, KNOWN);
  assert.equal(s.off, true);
  assert.equal(s.note, H.VOICE_OFF_ELSEWHERE_TEXT);
  assert.equal(H.VOICE_OFF_ELSEWHERE_TEXT, 'Voice chat is off while you are playing a qualifier.');
  assert.notEqual(s.note, H.VOICE_OFF_QUALIFIER_TEXT);
  // It lapses (GameHUD clears it after VOICE_REFUSED_ELSEWHERE_MS) and never applies to another table.
  assert.equal(H.VOICE_REFUSED_ELSEWHERE_MS, 60000);
  assert.deepEqual(H.voiceOffState(CASH, null, KNOWN), { off: false, note: null });
  assert.deepEqual(H.voiceOffState({ ...CASH, tableId: 'cash-2' }, a.refusedTableId, KNOWN), { off: false, note: null });
  // A qualifier table always shows the qualifier note.
  assert.deepEqual(H.voiceOffState(QUAL, null, KNOWN), { off: true, note: H.VOICE_OFF_QUALIFIER_TEXT });
  assert.deepEqual(H.voiceOffState(QUAL, 'qual-1', KNOWN), { off: true, note: H.VOICE_OFF_QUALIFIER_TEXT });
});

test('GameHUD: every voice-off frame remounts VoiceChat; the refusal lapses; the note is the computed one', () => {
  assert.match(GAMEHUD, /const action = voiceOffEventAction\(data\);/);
  assert.match(GAMEHUD, /if \(action\.remount\) setVoiceChatEpoch\(\(n\) => n \+ 1\);/);
  assert.doesNotMatch(GAMEHUD, /else setVoiceChatEpoch/, 'no longer only when the frame names no table');
  assert.match(GAMEHUD, /setTimeout\(\(\) => setVoiceRefusedTableId\(null\), VOICE_REFUSED_ELSEWHERE_MS\)/);
  assert.match(GAMEHUD, /const voiceState = voiceOffState\(gameState, voiceRefusedTableId\);/);
});

test("GameHUD's ownQualifierSeat signal: a player SEATED at a qualifier table (kept, now one of two signals)", () => {
  const q = { tableId: 'q1', isQualifier: true };
  const cash = { tableId: 'c1', tableKind: 'cash' };
  assert.equal(H.ownQualifierStreamBlocked(q, true, KNOWN), true, 'seated at a qualifier');
  assert.equal(H.ownQualifierStreamBlocked(q, false, KNOWN), false, 'not seated: this signal is false (goLiveOverlayOffAt covers him)');
  assert.equal(H.ownQualifierStreamBlocked(cash, true, KNOWN), false, 'cash seat keeps the URL');
  assert.equal(H.ownQualifierStreamBlocked(FIXTURES[1].gs, true, KNOWN), false, 'Sit & Go seat keeps the URL');
  assert.equal(H.ownQualifierStreamBlocked(q, 1, KNOWN), false, 'only a real boolean seat counts');
  assert.equal(H.OWN_QUALIFIER_STREAM_TEXT, undefined, 'the seated-only note is replaced by the official-stream note');
});

test('owner answer (b): the June Go Live overlay is off at EVERY qualifier table for everyone, on at every other table', () => {
  for (const f of FIXTURES) {
    assert.equal(H.goLiveOverlayOffAt(f.gs, KNOWN), f.q, `goLiveOverlayOffAt ${f.name}`);
    assert.equal(H.goLiveOverlayOffAt(f.gs, KNOWN), H.helpToolsOffAt(f.gs, KNOWN), `same test as helpToolsOffAt: ${f.name}`);
  }
  // poker-server's real spectator state at a qualifier table (index.ts getGameStateForPlayer).
  assert.equal(H.goLiveOverlayOffAt({ tableId: 'q9', isTournament: true, tournamentId: 't9', isQualifier: true, qualifierId: 'wq9', voiceChatAllowed: false, isSpectator: true }, new Set()), true);
  // ... and at a cash table / a Sit & Go (the per-socket delta clears the flags with false / null).
  assert.equal(H.goLiveOverlayOffAt({ tableId: 'c9', isTournament: false, tournamentId: null, isQualifier: false, qualifierId: null, voiceChatAllowed: true }, new Set()), false);
  assert.equal(H.goLiveOverlayOffAt({ tableId: 's9', isTournament: true, tournamentId: 't-s9', isQualifier: false, qualifierId: null, voiceChatAllowed: true, tableName: 'Sit & Go 9' }, new Set()), false);
  for (const junk of [null, undefined, 0, 'x', [], [{ isQualifier: true }]]) assert.equal(H.goLiveOverlayOffAt(junk, KNOWN), false);
  assert.equal(H.QUALIFIER_OFFICIAL_STREAM_TEXT, 'Qualifier tables are shown on the official American Pub Poker stream.');
});

test('owner answer (b): overlayQualifierSlate - the shown state, the preview, or (spectate) the NEWEST frame ahead of the delay', () => {
  const q = { tableId: 'q1', isQualifier: true };
  const cash = { tableId: 'c1', tableKind: 'cash', isQualifier: false };
  // Spectate mode, no delay: the frame on screen is a qualifier's.
  assert.equal(H.overlayQualifierSlate(q, null, true, KNOWN), true);
  // Spectate mode with a delay: nothing shown yet (or an older frame) but the newest frame is a qualifier's.
  assert.equal(H.overlayQualifierSlate(null, null, true, KNOWN), true, 'fail-closed before the delay passes');
  assert.equal(H.overlayQualifierSlate(cash, null, true, KNOWN), true);
  // The delayed frame on screen is still a qualifier's although the newest is not: still the slate.
  assert.equal(H.overlayQualifierSlate(q, null, false, KNOWN), true);
  // A table that is not a qualifier table by every check shows normally.
  assert.equal(H.overlayQualifierSlate(cash, null, false, KNOWN), false);
  assert.equal(H.overlayQualifierSlate(null, null, false, KNOWN), false, '"Waiting for table" stays');
  // Preview mode (the Go Live panel): the preview state decides.
  assert.equal(H.overlayQualifierSlate(cash, q, false, KNOWN), true, 'a fresh preview prop wins over the state it replaces');
  assert.equal(H.overlayQualifierSlate(cash, cash, false, KNOWN), false);
  assert.equal(H.overlayQualifierSlate(cash, cash, 1, KNOWN), false, 'only a real boolean counts');
});

test('StreamOverlayView wiring: every frame sets the newest-frame verdict; the slate is decided before any table is drawn', () => {
  assert.match(VIEW, /mergedRef\.current = next;\s+\/\/[^\n]*\n\s+setLatestQualifier\(goLiveOverlayOffAt\(next\)\);\s+show\(\{ state: next \}\);/);
  const slate = VIEW.indexOf('if (overlayQualifierSlate(state, previewState, !previewState && latestQualifier))');
  assert.ok(slate > 0, 'the slate check');
  assert.ok(slate < VIEW.indexOf('if (!state) {'), 'before "Waiting for table"');
  assert.ok(slate < VIEW.indexOf('const seats = (state.seats'), 'before any seat is read');
  const slateBody = VIEW.slice(slate, VIEW.indexOf('if (!state) {'));
  assert.match(slateBody, /\{QUALIFIER_OFFICIAL_STREAM_TEXT\}/);
  assert.doesNotMatch(slateBody, /state\.|playerName|chipCount|holeCards|communityCards|tableName/, 'the slate reads nothing from the table');
  // The closed-table screen it sits beside keeps its own text (the canonical token
  // "This table has closed." also matches another chunk, so it cannot catch a loss here).
  assert.match(VIEW, /\nconst OVERLAY_TABLE_CLOSED_TEXT = 'This table has closed\.';\n/);
  assert.match(VIEW, /<div className="sov-waiting sov-closed">\{OVERLAY_TABLE_CLOSED_TEXT\}<\/div>/);
});

test('opt-out: a signed-in frame is read only when it says a boolean', () => {
  assert.equal(H.broadcastOptOutOf({ broadcastOptOut: true }), true);
  assert.equal(H.broadcastOptOutOf({ broadcastOptOut: false }), false);
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { broadcastOptOut: true } }), true);
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { id: 1 } }), null);
  assert.equal(H.broadcastOptOutOf({ broadcastOptOut: 'true' }), null, 'a string is not a value');
  assert.equal(H.broadcastOptOutOf({ broadcastOptOut: 1 }), null);
  assert.equal(H.broadcastOptOutOf(null), null);
  assert.equal(H.broadcastOptOutOf([]), null);
});

test('opt-out: poker-server keeps it in loginResult.userData.stats (object or JSON text)', () => {
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { stats: { broadcastOptOut: true } } }), true);
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { stats: '{"broadcastOptOut":false,"handsPlayed":9}' } }), false);
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { stats: { handsPlayed: 9 } } }), null, 'no key: says nothing (no guessed toggle)');
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { stats: 'not json' } }), null);
  assert.equal(H.broadcastOptOutOf({ success: true, userData: { stats: { broadcastOptOut: 'yes' } } }), null);
});

test('opt-out: broadcastOptOutResult replies (contract v1 shape)', () => {
  assert.deepEqual(H.broadcastOptOutReply({ ok: true, optOut: true }), { ok: true, optOut: true });
  assert.deepEqual(H.broadcastOptOutReply({ ok: true, optOut: false }), { ok: true, optOut: false });
  assert.deepEqual(H.broadcastOptOutReply({ ok: false, code: 'login_required' }), { ok: false, code: 'login_required' });
  assert.deepEqual(H.broadcastOptOutReply({ ok: false }), { ok: false, code: 'save_failed' });
  assert.equal(H.broadcastOptOutReply({ ok: true }), null, 'ok without a boolean is not an answer');
  assert.equal(H.broadcastOptOutReply({ optOut: true }), null);
  assert.equal(H.broadcastOptOutReply(null), null);
});

test('opt-out merge is a no-op when unchanged (same object back), a change otherwise', () => {
  const a = H.mergeBroadcastOptOut(null, false, 42);
  assert.deepEqual(a, { owner: '42', optOut: false });
  assert.equal(H.mergeBroadcastOptOut(a, false, 42), a, 'same owner + value: the SAME object (no re-render)');
  assert.equal(H.mergeBroadcastOptOut(a, false, '42'), a, 'owner id as string or number is the same account');
  assert.equal(H.mergeBroadcastOptOut(a, null, 42), a, 'no value: unchanged');
  assert.equal(H.mergeBroadcastOptOut(a, 'yes', 42), a, 'non-boolean: unchanged');
  assert.equal(H.mergeBroadcastOptOut(a, true, null), a, 'no owner: unchanged');
  const b = H.mergeBroadcastOptOut(a, true, 42);
  assert.notEqual(b, a);
  assert.deepEqual(b, { owner: '42', optOut: true }, 'a change made elsewhere reaches this tab (self-heal)');
  const c = H.mergeBroadcastOptOut(b, true, 7);
  assert.deepEqual(c, { owner: '7', optOut: true }, 'another account replaces it');
});

test('opt-out is shown only for its own account', () => {
  const s = { owner: '42', optOut: true };
  assert.equal(H.broadcastOptOutFor(s, 42), true);
  assert.equal(H.broadcastOptOutFor(s, '42'), true);
  assert.equal(H.broadcastOptOutFor(s, 7), null, 'another account never sees it');
  assert.equal(H.broadcastOptOutFor(null, 42), null);
  assert.equal(H.broadcastOptOutFor(s, null), null);
});

test('opt-out refusal text is plain words', () => {
  assert.equal(H.broadcastOptOutErrorText('login_required'), 'Sign in to change this.');
  assert.match(H.broadcastOptOutErrorText('save_failed'), /try again/i);
  assert.match(H.broadcastOptOutErrorText('no_answer'), /did not answer/i);
  assert.match(H.broadcastOptOutErrorText(undefined), /try again/i);
  assert.match(H.broadcastOptOutErrorText('rate_limited'), /wait a moment/i);
  assert.match(H.broadcastOptOutErrorText('load_failed'), /try again/i);
});

test('lock-token texts', () => {
  assert.equal(H.VOICE_OFF_QUALIFIER_TEXT, 'Voice chat is off at qualifier tables.');
  assert.equal(H.BROADCAST_OPT_OUT_LABEL, 'Show me as Player on broadcasts');
  assert.match(H.QUALIFIER_BROADCAST_NOTICE_TEXT, /first name and last initial/);
  assert.doesNotMatch(H.QUALIFIER_BROADCAST_NOTICE_TEXT, /\d+\s*min/i, 'no minute count on the card (the delay is a server setting)');
});

// Owner 2026-11-02 approved wording (B1), word for word.
const APPROVED = [
  'Qualifier tables may be shown live and in replays on our social pages with your public name (first name and last initial), avatar and chip count. Hole cards are shown only on a delay or after the event.',
  '21+ to enter.',
  'Streamers and commentators may not play an event they broadcast. No watching the stream or your own event while you play.',
];

const LOBBY_SRC = readSrc('components/ui/QualifierLobby.jsx');
const SETTINGS_SRC = readSrc('components/ui/SettingsPanel.jsx');

test('fix round 2026-11-02: the qualifier card streaming notice IS approved line (1), word for word (no paraphrase)', () => {
  assert.equal(H.QUALIFIER_BROADCAST_NOTICE_TEXT, APPROVED[0]);
  assert.doesNotMatch(H.QUALIFIER_BROADCAST_NOTICE_TEXT, /This event may be streamed/, 'the paraphrase is gone');
  // The card renders the constant (and the toggle stays beside it).
  assert.match(LOBBY_SRC, /\{QUALIFIER_BROADCAST_NOTICE_TEXT\}/);
  assert.match(LOBBY_SRC, /\{BROADCAST_OPT_OUT_LABEL\}/, '"Show me as Player on broadcasts" toggle kept');
  assert.equal(H.BROADCAST_OPT_OUT_LABEL, 'Show me as Player on broadcasts');
});

test('fix round 2026-11-02: the Settings legal line states 21+ with approved line (2), word for word', () => {
  const legal = SETTINGS_SRC.slice(SETTINGS_SRC.indexOf('settings-section settings-legal'));
  const line = (legal.match(/<span[^>]*>\s*([^<]*?)\s*<\/span>/) || [])[1];
  assert.equal(line, 'Play money only. 21+ to enter.');
  assert.doesNotMatch(SETTINGS_SRC, /21\+ to enter qualifiers/, 'the paraphrase is gone');
  // Every 21+ statement the Legal section shows is the approved line.
  const shown = [...legal.matchAll(/21\+[^<'"\n]*/g)].map((m) => m[0]);
  assert.deepEqual(shown, ['21+ to enter.']);
  // The links (navigational) stay.
  assert.match(legal, />\s*Terms of Service\s*</);
  assert.match(legal, />\s*Privacy Policy\s*</);
});

function allLines(sections) { return sections.flatMap((s) => s.rules); }

test('qualifierRulesFor includes the three approved lines verbatim (no qualifier and a weekly one)', () => {
  const weekly = { type: 'weekly', seatsForTop: 3, lateRegClosesAtBubble: true, seedsHeldUntilEnd: true };
  for (const q of [null, weekly]) {
    const lines = allLines(R.qualifierRulesFor(q));
    for (const a of APPROVED) assert.ok(lines.includes(a), `missing: ${a}`);
  }
  const who = R.qualifierRulesFor(null).find((s) => s.heading === 'Who can play');
  assert.equal(who.rules[0], '21+ to enter.', '21+ leads Who can play');
  const live = R.qualifierRulesFor(null).find((s) => s.heading === 'Live streams');
  assert.ok(live, 'Live streams section');
  assert.deepEqual(live.rules, [APPROVED[0], APPROVED[2]]);
});

test('rules: date bumped, every section kept, text plain ASCII, no 15-minute delay anywhere', () => {
  assert.equal(R.QUALIFIER_RULES_UPDATED, '2026-11-02');
  assert.equal(R.rulesUpdatedLine(), 'Updated Nov 2, 2026.');
  const headings = R.QUALIFIER_RULES.map((s) => s.heading);
  for (const h of ['About the qualifier', 'Who can play', 'Schedule', 'Re-entries', 'Absent at the start', 'Structure',
    'Blinds and antes', 'Seating', 'Bubble and ties', 'Prizes', 'Disconnects and time to act', 'If something goes wrong',
    'Fair play', 'Live streams', 'Fair shuffle']) assert.ok(headings.includes(h), `section ${h}`);
  const raw = JSON.stringify(R.QUALIFIER_RULES);
  assert.ok(/^[\x20-\x7e]*$/.test(raw), 'plain ASCII (AGENT.md rule 20)');
  assert.doesNotMatch(raw, /15[- ]minute/i, 'owner: the delay is 5 minutes, never 15');
});

// Static guards on the JSX (no React renderer in node): the features stay.
const GAMEHUD = readSrc('components/game/GameHUD.jsx');
const OVERLAY = readSrc('components/ui/StreamOverlay.jsx');

test('GameHUD: Voice Chat is only swapped for the note at a qualifier table; Go Live always renders', () => {
  const grid = GAMEHUD.slice(GAMEHUD.indexOf('Live & Social'), GAMEHUD.indexOf('Share Hand'));
  assert.match(grid, /\{voiceOff \? \(\s*<div className="options-help-off-note options-voice-off-note"[^]*?\{voiceOffNote\}[^]*?\) : \(\s*<button[^\n]*setShowVoiceChat[^\n]*>🎙 Voice Chat<\/button>\s*\)\}/);
  assert.match(GAMEHUD, /const voiceOffNote = voiceState\.note \|\| VOICE_OFF_QUALIFIER_TEXT;/, 'the qualifier note is still the default');
  // Go Live is outside that ternary and unconditional.
  const goLive = grid.indexOf('📺 Go Live');
  assert.ok(goLive > grid.indexOf('🎙 Voice Chat'), 'Go Live after Voice Chat');
  const between = grid.slice(grid.indexOf('🎙 Voice Chat'), goLive);
  assert.match(between, /<\/button>\s*\)\}\s*<button className=\{`options-adv-btn \$\{showStream/, 'Go Live is its own unconditional button');
  assert.match(grid, /🎲 Prediction Market/, 'Prediction Market kept');
  // VoiceChat mounted unless voice is off; StreamOverlay always mounted.
  assert.match(GAMEHUD, /\{!voiceOff && \(\s*<VoiceChat\s+key=\{`voice-\$\{voiceChatEpoch\}`\}/);
  assert.match(GAMEHUD, /\n\s*<StreamOverlay\s+gameState=\{gameState\}[^]*?ownQualifierSeat=\{ownQualifierSeatStream\}/);
  assert.doesNotMatch(GAMEHUD, /!voiceOff && \(\s*<StreamOverlay/);
});

const LOBBY = readSrc('components/ui/QualifierLobby.jsx');
const SETTINGS = readSrc('components/ui/SettingsPanel.jsx');
const APP = readSrc('App.jsx');
const VIEW = readSrc('components/ui/StreamOverlayView.jsx');

test('QualifierLobby: notice on the home card AND every Play-tab card, toggle wired to the v1 contract', () => {
  assert.equal((LOBBY.match(/\{broadcastNotice\(q\)\}/g) || []).length, 2, 'home card + list card');
  assert.match(LOBBY, /socket\.emit\('setBroadcastOptOut', \{ optOut: want \}\)/);
  assert.match(LOBBY, /socket\.emit\('getBroadcastOptOut', \{\}\)/);
  assert.match(LOBBY, /socket\.on\('broadcastOptOutResult', onResult\)/);
  assert.match(LOBBY, /socket\.off\('broadcastOptOutResult', onResult\)/);
  // Self-heal: on mount (askBroadcastOptOut() in the effect), after sign-in, on resume.
  assert.match(LOBBY, /socket\.on\('loginResult', onSignIn\)/);
  assert.match(LOBBY, /window\.addEventListener\('poker3d:tab-resumed', onResume\)/);
  assert.match(LOBBY, /window\.removeEventListener\('poker3d:tab-resumed', onResume\)/);
  // The toggle shows only once the server has answered (never a guessed box).
  assert.match(LOBBY, /owner != null && \(optOut !== null \|\| optOutPending !== null\) && \(/);
  // No red in what was added.
  const added = LOBBY.slice(LOBBY.indexOf('const broadcastNotice'), LOBBY.indexOf('// Dashboard modal'));
  assert.doesNotMatch(added, /#(?:f00|ff0000|e53935|dc2626|ef4444|d11)\b|\bred\b/i);
});

test('SettingsPanel: Terms + Privacy links to the marketing routes, new tab, no opener', () => {
  assert.match(SETTINGS, /'https:\/\/americanpubpoker\.com\/terms'/);
  assert.match(SETTINGS, /'https:\/\/americanpubpoker\.com\/privacy'/);
  assert.equal((SETTINGS.match(/rel="noopener noreferrer"/g) || []).length, 2);
  // every earlier section kept
  for (const s of ['Notifications', 'Sound', 'Gameplay', 'Display', 'App', 'Legal']) {
    assert.match(SETTINGS, new RegExp(`settings-section-title">${s}<`));
  }
});

test('App: ?overlay= mode skips the player wiring and the boot sign-in; normal mode unchanged', () => {
  const connect = APP.indexOf('// Connect to server on mount and wire up event listeners');
  const connectBody = APP.slice(connect, connect + 900);
  assert.match(connectBody, /if \(overlayConfig\) return undefined;\s+const socket = connectToServer\(\);/);
  const auto = APP.indexOf('// Auto-login: try OAuth refresh token first, then legacy token');
  const autoBody = APP.slice(auto, auto + 900);
  assert.match(autoBody, /if \(overlayConfig\) return;\s+\/\/ Skip auto-login if we're handling an OAuth callback\s+if \(isOAuthCallback\) return;/);
  assert.match(APP, /\}, \[isOAuthCallback, overlayConfig\]\);/);
  assert.match(APP, /const \[overlayConfig\] = useState\(\(\) => parseOverlayParam\(\)\);/, 'never set after mount');
  assert.match(APP, /if \(overlayConfig\) \{\s+return \(\s+<Suspense fallback=\{null\}>\s+<StreamOverlayView/, 'overlay route kept');
});

test('StreamOverlayView: re-spectates on every connect, follows a table move, says a closed table', () => {
  assert.match(VIEW, /socket\.on\('connect', requestSpectate\);\s+if \(socket\.connected\) requestSpectate\(\);/);
  assert.match(VIEW, /socket\.emit\('spectate', \{ tableId: watchedRef\.current \}\)/);
  assert.match(VIEW, /socket\.on\('spectatingTournament', onSpectatingTournament\)/);
  assert.match(VIEW, /socket\.on\('tableClosed', onTableClosed\)/);
  assert.match(VIEW, /e\.message === 'Table not found'/);
  for (const ev of ['gameState', 'spectatingTournament', 'tableClosed', 'error', 'connect']) {
    assert.match(VIEW, new RegExp(`socket\\.off\\('${ev}'`), `cleanup removes ${ev}`);
  }
  assert.match(VIEW, /isShowdown && s\.holeCards/, 'hole cards still only at showdown');
});

test('StreamOverlay: copy fixed, URL kept at every table but a qualifier table (owner answer (b): for everyone there)', () => {
  assert.doesNotMatch(OVERLAY, /snipe your table/, 'the misleading line is gone');
  assert.match(OVERLAY, /Holds only this overlay graphic back/);
  assert.match(OVERLAY, /leave “Shutdown source when not visible”\s+unticked/);
  assert.match(OVERLAY, /OBS Browser-Source URL/, 'URL field kept');
  assert.match(OVERLAY, /const qualifierOverlayOff = ownQualifierSeat === true \|\| goLiveOverlayOffAt\(gameState\);/, 'seated OR watching');
  assert.match(OVERLAY, /tableId && !qualifierOverlayOff/, 'the URL is built for every table but a qualifier table');
  assert.match(OVERLAY, /ownQualifierSeat = false/, 'default: the URL shows');
  assert.match(OVERLAY, /\{QUALIFIER_OFFICIAL_STREAM_TEXT\}/);
  assert.doesNotMatch(OVERLAY, /OWN_QUALIFIER_STREAM_TEXT/);
});

// Fix round 2026-11-02 (owner): approved rules line (2) "21+ to enter." is the
// ONLY way the age rule is put into words. A bare "21+" tag in a label or a
// comment is not a sentence and stays; the on-air legal line itself ends in the
// approved line (next test).
const SRC_ROOT = new URL('../../src/', import.meta.url);
function srcFiles(dirUrl) {
  return fs.readdirSync(dirUrl, { withFileTypes: true }).flatMap((e) => {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dirUrl);
    if (e.isDirectory()) return srcFiles(u);
    return /\.(js|jsx|mjs|json|css|html|md|txt)$/.test(e.name) ? [u] : [];
  });
}
const AGE_PARAPHRASES = [
  /\b21\s*(?:or|and)\s*(?:older|over|up)\b/i,
  /\bover\s+(?:the\s+age\s+of\s+)?21\b/i,
  /\bage(?:d|s)?\s+(?:of\s+)?21\b/i,
  /\b21\s*(?:years|yrs)\b/i,
  /\bmust\s+be\s+(?:at\s+least\s+)?21\b/i,
  /\btwenty[- ]one\b/i,
  /\b(?:under|below)\s*(?:the\s+age\s+of\s+)?21\b/i,
  /\b21\s*\+\s*(?:only|players|required|needed)\b/i,
];

test('fix round 2026-11-02: no paraphrase of the 21+ rule ships in src/ - only "21+ to enter." word for word (or a bare 21+ tag in a label)', () => {
  const files = srcFiles(SRC_ROOT);
  assert.ok(files.length > 100, 'walked src/');
  const bad = [];
  let approved = 0;
  for (const u of files) {
    const text = fs.readFileSync(u, 'utf8');
    const rel = u.href.slice(SRC_ROOT.href.length);
    for (const re of AGE_PARAPHRASES) {
      const m = text.match(re);
      if (m) bad.push(`${rel}: "${m[0]}"`);
    }
    // Every "21+" followed by words must be the approved line itself, period included.
    for (const m of text.matchAll(/21\s*\+[ \t]*(?=[A-Za-z])/g)) {
      const rest = text.slice(m.index, m.index + 40);
      if (rest.startsWith('21+ to enter.')) approved++;
      else bad.push(`${rel}: "${rest.split('\n')[0]}"`);
    }
  }
  assert.deepEqual(bad, [], 'paraphrases of the 21+ rule');
  assert.ok(approved >= 3, 'the approved line itself ships (rules, Settings, starting-soon card)');
});

// Fix round 2026-11-02 (checker): the on-air legal line ended in a bare "21+".
// It now ends in approved rules line (2) "21+ to enter." word for word, the rest
// of the line unchanged. The page's fallback (contract.js LEGAL_LINE) and the
// producer's legal lower third are ONE constant, and every dev fixture (a copy
// of what poker-server sends as program.legal.line) carries the same line.
const APPROVED_LEGAL_LINE = 'Free to play · Play money only · No purchase necessary · 21+ to enter.';

test('fix round 2026-11-02: the on-air legal line ends in "21+ to enter." word for word, never a bare "21+"', async () => {
  const C = await import(new URL('broadcast/model/contract.js', SRC_DIR).href);
  const P = await import(new URL('components/producer/producerModel.js', SRC_DIR).href);
  assert.equal(C.LEGAL_LINE, APPROVED_LEGAL_LINE);
  assert.ok(C.LEGAL_LINE.endsWith(` · ${APPROVED[1]}`), 'ends in approved line (2)');
  // The producer's legal lower third, with no line on the program, is the same constant.
  for (const program of [{}, null, { legal: {} }, { legal: { line: '' } }, { legal: { line: 7 } }]) {
    assert.equal(P.lowerThirdPresets(program).find((p) => p.key === 'legal').title, C.LEGAL_LINE);
  }
  // ...and it fits a lower third whole (lowerThirdItem keeps 80 characters of title).
  assert.equal(P.lowerThirdItem({ id: 'legal', kind: 'legal', title: C.LEGAL_LINE, durationSec: 0, programNow: 0 }).title, C.LEGAL_LINE);
  // One constant: producerModel imports it and keeps no second copy of the line.
  const pm = readSrc('components/producer/producerModel.js');
  assert.match(pm, /import \{[^}]*\bLEGAL_LINE\b[^}]*\} from '\.\.\/\.\.\/broadcast\/model\/contract\.js';/);
  assert.ok(!pm.includes('No purchase necessary'), 'no second copy of the legal line in producerModel.js');
  // No file in src/ carries the old line (the legal list ending in a bare "21+").
  const old = [];
  for (const u of srcFiles(SRC_ROOT)) {
    const text = fs.readFileSync(u, 'utf8');
    if (/No purchase necessary · 21\+(?! to enter\.)/.test(text)) old.push(u.href.slice(SRC_ROOT.href.length));
  }
  assert.deepEqual(old, [], 'files still ending the legal line in a bare 21+');
  // Every dev fixture's legal line (snapshot + frames) is the approved line.
  const FX = new URL('broadcast/dev/fixtures/', SRC_DIR);
  const lines = [];
  const collect = (v) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      if (v.legal && typeof v.legal === 'object' && 'line' in v.legal) lines.push(v.legal.line);
      Object.values(v).forEach(collect);
    }
  };
  for (const f of fs.readdirSync(FX).filter((n) => n.endsWith('.json'))) collect(JSON.parse(fs.readFileSync(new URL(f, FX), 'utf8')));
  assert.ok(lines.length >= 8, 'a legal line in every fixture');
  assert.deepEqual([...new Set(lines)], [APPROVED_LEGAL_LINE]);
});
