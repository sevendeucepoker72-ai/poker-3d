// Shape checks for the broadcast wire contract v1 (lead spec §3, plus the
// 2026-11-02 `liveHandEndedAt` field). Used on the DEV fixtures today and on
// poker-server's recorded fixtures (tests/fixtures/broadcast/*.json, S7a)
// once they are copied into src/broadcast/dev/fixtures/. Returns a list of
// problems ([] = the payload matches).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = Number.isInteger;
const isStr = (v) => typeof v === 'string';
const nullOr = (pred) => (v) => v === null || pred(v);

const SCENES = ['starting', 'table', 'break', 'hfh', 'finalIntro', 'results', 'slate', 'recap', 'room'];
const STATUSES = ['scheduled', 'registering', 'tables_open', 'running', 'finished', 'cancelled'];
const TICKER_KINDS = ['bust', 'doubleUp', 'levelUp', 'breakStart', 'breakEnd', 'hfhOn', 'hfhOff', 'lateRegClosed', 'tableBroken', 'finalTable', 'featured', 'finished'];
const FEATURED_MODES = ['auto', 'producer', 'final_table'];
// Keys no broadcast payload may ever carry (§3 "No payload ever carries ...").
export const FORBIDDEN_KEYS = ['playerId', 'masterUserId', 'userId', 'publicId', 'seed', 'deck', 'burn', 'burnCards', 'playerName', 'yourCards', 'yourSeat'];

function need(errs, path, ok) { if (!ok) errs.push(path); }

export function cardOk(c) {
  return isObj(c) && isInt(c.rank) && c.rank >= 2 && c.rank <= 14 && isInt(c.suit) && c.suit >= 0 && c.suit <= 3;
}

export function checkFeed(feed, path = 'feed') {
  const e = [];
  need(e, `${path}`, isObj(feed));
  if (!isObj(feed)) return e;
  need(e, `${path}.mode`, ['public', 'delayed'].includes(feed.mode));
  need(e, `${path}.delayMs`, isNum(feed.delayMs));
  need(e, `${path}.holeCards`, typeof feed.holeCards === 'boolean');
  need(e, `${path}.policy`, ['off', 'after_event', 'delayed'].includes(feed.policy));
  // 2026-11-02 (owner): hole cards need a delayed feed of at least 5 minutes.
  if (feed.holeCards === true) need(e, `${path}.holeCards needs delayed >= 5 min`, feed.mode === 'delayed' && feed.delayMs >= 300000);
  return e;
}

export function checkTableFrame(t, path = 'table') {
  const e = [];
  if (!isObj(t)) return [`${path}`];
  for (const k of ['t', 'handNumber', 'maxSeats', 'pot', 'dealerSeat', 'smallBlindSeat', 'bigBlindSeat', 'activeSeat']) need(e, `${path}.${k}`, isNum(t[k]));
  need(e, `${path}.tableId`, isStr(t.tableId));
  need(e, `${path}.tableNo`, nullOr(isInt)(t.tableNo));
  need(e, `${path}.tableName`, isStr(t.tableName));
  need(e, `${path}.featured`, typeof t.featured === 'boolean');
  need(e, `${path}.phase`, isStr(t.phase));
  need(e, `${path}.handLevel`, isObj(t.handLevel) && isNum(t.handLevel.sb) && isNum(t.handLevel.bb) && isNum(t.handLevel.ante));
  need(e, `${path}.turnStartedAt`, nullOr(isNum)(t.turnStartedAt));
  need(e, `${path}.turnTimeout`, nullOr(isNum)(t.turnTimeout));
  need(e, `${path}.board`, Array.isArray(t.board) && t.board.length <= 5 && t.board.every(cardOk));
  if ('liveHandEndedAt' in t) need(e, `${path}.liveHandEndedAt`, nullOr(isNum)(t.liveHandEndedAt));
  // 2026-11-02 (P5-C2b): the delayed feed's release mark.
  if ('holeCardsReleasedAt' in t) need(e, `${path}.holeCardsReleasedAt`, nullOr(isNum)(t.holeCardsReleasedAt));
  need(e, `${path}.seats`, Array.isArray(t.seats));
  (t.seats || []).forEach((s, i) => {
    const p = `${path}.seats[${i}]`;
    need(e, p, isObj(s));
    if (!isObj(s)) return;
    need(e, `${p}.seatIndex`, isInt(s.seatIndex));
    need(e, `${p}.pid`, isStr(s.pid) && /^b-[0-9a-f]{16}$/.test(s.pid));
    need(e, `${p}.name`, isStr(s.name));
    for (const k of ['chips', 'bet']) need(e, `${p}.${k}`, isNum(s[k]));
    for (const k of ['folded', 'allIn', 'sittingOut', 'eliminated', 'hasCards']) need(e, `${p}.${k}`, typeof s[k] === 'boolean');
    need(e, `${p}.holeCards`, s.holeCards === null || (Array.isArray(s.holeCards) && s.holeCards.every(cardOk)));
  });
  if (t.handResult !== null) {
    const hr = t.handResult;
    need(e, `${path}.handResult`, isObj(hr) && Array.isArray(hr.winners) && Array.isArray(hr.showdownSeats) && Array.isArray(hr.muckedSeats));
  }
  return e;
}

export function checkProgram(p, path = 'program') {
  const e = [];
  if (!isObj(p)) return [`${path}`];
  need(e, `${path}.v`, p.v === 1);
  need(e, `${path}.channel`, isStr(p.channel));
  need(e, `${path}.eventKey`, isStr(p.eventKey) && /^(q:|t:|next:)/.test(p.eventKey));
  need(e, `${path}.onAir`, typeof p.onAir === 'boolean');
  need(e, `${path}.rehearsal`, typeof p.rehearsal === 'boolean');
  need(e, `${path}.programNow`, isNum(p.programNow));
  const ev = p.event;
  need(e, `${path}.event`, isObj(ev));
  if (isObj(ev)) {
    need(e, `${path}.event.kind`, ['weekly', 'monthly', 'sitgo'].includes(ev.kind));
    need(e, `${path}.event.status`, STATUSES.includes(ev.status));
    need(e, `${path}.event.name`, isStr(ev.name));
    need(e, `${path}.event.levels`, Array.isArray(ev.levels));
    need(e, `${path}.event.prizes`, isObj(ev.prizes) && ['seats', 'chips'].includes(ev.prizes.kind) && Array.isArray(ev.prizes.rows));
    need(e, `${path}.event.lateReg`, isObj(ev.lateReg));
  }
  need(e, `${path}.scene`, isObj(p.scene) && SCENES.includes(p.scene.id) && typeof p.scene.auto === 'boolean');
  need(e, `${path}.featured`, isObj(p.featured) && FEATURED_MODES.includes(p.featured.mode));
  need(e, `${path}.standings`, isObj(p.standings) && Array.isArray(p.standings.leaders) && p.standings.leaders.length <= 10);
  need(e, `${path}.ticker`, Array.isArray(p.ticker) && p.ticker.length <= 30 && p.ticker.every((x) => isObj(x) && TICKER_KINDS.includes(x.kind)));
  need(e, `${path}.lowerThirds`, Array.isArray(p.lowerThirds));
  need(e, `${path}.legal`, isObj(p.legal) && p.legal.line === 'Free to play · Play money only · No purchase necessary · 21+ to enter.');
  need(e, `${path}.results`, p.results === null || Array.isArray(p.results));
  need(e, `${path}.finalTable`, p.finalTable === null || (isObj(p.finalTable) && Array.isArray(p.finalTable.seats)));
  return e;
}

export function checkSnapshot(s) {
  const e = [];
  if (!isObj(s)) return ['snapshot'];
  need(e, 'snapshot.v', s.v === 1);
  need(e, 'snapshot.seq', isInt(s.seq));
  need(e, 'snapshot.serverNow', isNum(s.serverNow));
  e.push(...checkFeed(s.feed, 'snapshot.feed'));
  e.push(...checkProgram(s.program, 'snapshot.program'));
  if (s.table !== null) e.push(...checkTableFrame(s.table, 'snapshot.table'));
  return e;
}

export function checkFrameMsg(msg, i = 0) {
  const p = `frames[${i}]`;
  if (!isObj(msg)) return [p];
  if (msg.kind === 'table') return checkTableFrame(msg.table, `${p}.table`);
  if (msg.kind === 'program') return checkProgram(msg.program, `${p}.program`);
  if (msg.kind === 'event') return isObj(msg.event) && TICKER_KINDS.includes(msg.event.kind) ? [] : [`${p}.event`];
  return [`${p}.kind`];
}

const SHOWDOWN = ['Showdown', 'HandComplete'];
function shownAtShowdown(t, s) {
  const hr = t.handResult;
  return SHOWDOWN.includes(t.phase) && isObj(hr) && Array.isArray(hr.showdownSeats) && hr.showdownSeats.length >= 2
    && hr.showdownSeats.includes(s.seatIndex) && !(hr.muckedSeats || []).includes(s.seatIndex) && !s.folded && !s.mucked;
}

/**
 * 2026-11-02 (P5-C2b) — what a CORRECT server does with the release mark
 * (owner HARD RULE: a hand's hole cards are never released while it is still
 * live). A public frame never carries `holeCardsReleasedAt`. A delayed frame
 * that carries hole cards outside a contested showdown carries the mark, and
 * the mark is never before the hand's live end or the frame's t + delay.
 * (The public fixtures that deliberately leak a live card to exercise the
 * page's second wall are not checked for cards here; fixtures.test does that.)
 */
export function releaseRuleProblems(t, feed, path = 'table') {
  const e = [];
  if (!isObj(t) || !isObj(feed)) return e;
  const mark = t.holeCardsReleasedAt;
  const delayed = feed.mode === 'delayed' && feed.holeCards === true;
  if (!delayed) {
    need(e, `${path}.holeCardsReleasedAt on a public feed`, mark === undefined || mark === null);
    return e;
  }
  const carries = (t.seats || []).some((s) => isObj(s) && Array.isArray(s.holeCards) && s.holeCards.length > 0 && !shownAtShowdown(t, s));
  if (carries) need(e, `${path}: delayed cards without holeCardsReleasedAt`, isNum(mark));
  if (isNum(mark)) {
    need(e, `${path}.holeCardsReleasedAt before the live end`, isNum(t.liveHandEndedAt) && mark >= t.liveHandEndedAt);
    need(e, `${path}.holeCardsReleasedAt before t + delay`, isNum(t.t) && mark >= t.t + feed.delayMs);
  }
  return e;
}

/** Every forbidden key anywhere in a payload, as paths. */
export function forbiddenKeyPaths(value, path = '$', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => forbiddenKeyPaths(v, `${path}[${i}]`, out));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) out.push(`${path}.${k}`);
      forbiddenKeyPaths(v, `${path}.${k}`, out);
    }
  }
  return out;
}
