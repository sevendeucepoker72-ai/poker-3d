/**
 * The broadcast scene machine (lead spec R2 + C4, 2026-11-02). PURE: the
 * scene is a function of the program (server data) and the program clock
 * only — no memory, no Date.now, no layout — so the 16:9 and the 9:16 OBS
 * sources, and a source reloaded mid-show, always agree on what is on air.
 *
 * Order of precedence:
 *   1. The feed is stale (no heartbeat for 15 s) or there is no program: the
 *      slate. Nothing overrides this.
 *   2. scene.auto is OFF: the producer's pinned scene — except that results
 *      are NEVER shown before the program reaches the finish (rule 4); a
 *      pinned Results waits on the auto scene until then.
 *   3. scene.auto is ON, from the program:
 *        status scheduled / registering / tables_open, or the clock held for
 *          the start ('prestart')                      -> starting
 *        status cancelled                              -> slate
 *        status finished and the results visible        -> results
 *        the clock on a scheduled break                 -> break
 *        the final table, for its intro window          -> finalIntro
 *        hand-for-hand on                               -> hfh
 *        otherwise                                      -> table
 *   4. Results are visible only when program.results has rows, the event is
 *      finished, and programNow has reached the finish time (the 'finished'
 *      ticker item's time, else the program frame's own programNow). On a
 *      delayed feed the server replays the program at its original time, so
 *      this is the second wall against a spoiler.
 *
 * The final-table intro plays ONCE per event: its window starts at the first
 * 'finalTable' ticker item (else featured.since while featured.mode is
 * 'final_table') and lasts FINAL_INTRO_PER_SEAT_MS per seat (+ a lead-in). A
 * source loaded after the window never replays it; a later re-feature of the
 * final table never replays it (the ticker item keeps the first time).
 */
import { isObj, SCENE_IDS } from './contract.js';

export const FINAL_INTRO_PER_SEAT_MS = 4000;
export const FINAL_INTRO_LEAD_MS = 3000;
export const FINAL_INTRO_MIN_MS = 8000;
export const FINAL_INTRO_MAX_MS = 45000;

const PRE_START = new Set(['scheduled', 'registering', 'tables_open']);

function eventOf(program) {
  return isObj(program) && isObj(program.event) ? program.event : {};
}

function tickerOf(program) {
  return isObj(program) && Array.isArray(program.ticker) ? program.ticker.filter(isObj) : [];
}

/** The program time the event finished, or null (not finished / unknown). */
export function finishTimeOf(program) {
  if (eventOf(program).status !== 'finished') return null;
  let first = null;
  for (const ev of tickerOf(program)) {
    if (ev.kind === 'finished' && Number.isFinite(ev.t) && (first === null || ev.t < first)) first = ev.t;
  }
  if (first !== null) return first;
  return Number.isFinite(program.programNow) ? program.programNow : null;
}

/** Results may be drawn: rows, finished, and programNow at / past the finish. Fail-closed. */
export function resultsVisible(program, programNow) {
  if (!isObj(program) || !Array.isArray(program.results) || program.results.length === 0) return false;
  const at = finishTimeOf(program);
  return at !== null && Number.isFinite(programNow) && programNow >= at;
}

/** Seats at the final table (the intro's cards). */
export function finalTableSeats(program) {
  const ft = isObj(program) && isObj(program.finalTable) ? program.finalTable : null;
  return ft && Array.isArray(ft.seats) ? ft.seats.filter(isObj) : [];
}

/** How long the intro plays for `seatCount` seats. */
export function finalIntroDuration(seatCount) {
  const n = Number.isInteger(seatCount) && seatCount > 0 ? seatCount : 0;
  return Math.max(FINAL_INTRO_MIN_MS, Math.min(FINAL_INTRO_MAX_MS, FINAL_INTRO_LEAD_MS + n * FINAL_INTRO_PER_SEAT_MS));
}

/** {start, end} of the final-table intro on the program clock, or null. */
export function finalIntroWindow(program) {
  const seats = finalTableSeats(program);
  if (seats.length === 0) return null;
  let start = null;
  for (const ev of tickerOf(program)) {
    if (ev.kind === 'finalTable' && Number.isFinite(ev.t) && (start === null || ev.t < start)) start = ev.t;
  }
  const f = isObj(program.featured) ? program.featured : null;
  if (start === null && f && f.mode === 'final_table' && Number.isFinite(f.since) && f.since > 0) start = f.since;
  if (start === null) return null;
  return { start, end: start + finalIntroDuration(seats.length) };
}

/**
 * The intro card up `programNow - start` into an intro of `seats`:
 * {index, seat, leadIn} (leadIn = the 'FINAL TABLE' title before the first
 * card). `loop` (a producer-pinned intro) goes round the seats again; else the
 * last card holds.
 */
export function introCardAt(seats, start, programNow, loop = false) {
  if (!Array.isArray(seats) || seats.length === 0 || !Number.isFinite(start) || !Number.isFinite(programNow)) return null;
  const into = Math.max(0, programNow - start);
  if (into < FINAL_INTRO_LEAD_MS) return { index: -1, seat: null, leadIn: true };
  const step = Math.floor((into - FINAL_INTRO_LEAD_MS) / FINAL_INTRO_PER_SEAT_MS);
  const index = loop ? step % seats.length : Math.min(seats.length - 1, step);
  return { index, seat: seats[index] || null, leadIn: false };
}

/**
 * Which intro card is up at programNow in the AUTO window: {index, seat,
 * leadIn}, or null outside the window.
 */
export function finalIntroCard(program, programNow) {
  const w = finalIntroWindow(program);
  if (!w || !Number.isFinite(programNow) || programNow < w.start || programNow >= w.end) return null;
  return introCardAt(finalTableSeats(program), w.start, programNow, false);
}

/** The intro card of a PRODUCER-pinned intro (from scene.since, looping), or null. */
export function pinnedIntroCard(program, programNow) {
  const since = isObj(program) && isObj(program.scene) && Number.isFinite(program.scene.since) ? program.scene.since : null;
  return introCardAt(finalTableSeats(program), since, programNow, true);
}

/** True inside the intro window of the final table (auto scene only). */
export function finalIntroActive(program, programNow) {
  return finalIntroCard(program, programNow) !== null;
}

/** The auto scene for the program at programNow (rule 3). */
export function autoScene(program, programNow) {
  const ev = eventOf(program);
  const clock = isObj(program.clock) ? program.clock : null;
  if (PRE_START.has(ev.status) || (clock && clock.paused && clock.pauseReason === 'prestart')) {
    return { id: 'starting', reason: 'pre_start' };
  }
  if (ev.status === 'cancelled') return { id: 'slate', reason: 'cancelled' };
  if (ev.status === 'finished') {
    if (resultsVisible(program, programNow)) return { id: 'results', reason: 'finished' };
    return { id: 'table', reason: 'results_pending' };
  }
  if (clock && clock.paused && clock.pauseReason === 'break') return { id: 'break', reason: 'break' };
  if (finalIntroActive(program, programNow)) return { id: 'finalIntro', reason: 'final_table' };
  if (isObj(program.handForHand) && program.handForHand.on === true) return { id: 'hfh', reason: 'hand_for_hand' };
  return { id: 'table', reason: 'play' };
}

/**
 * The scene on air: {id, reason, pinned}.
 * @param {{program:object|null, programNow:number, stale?:boolean}} input
 */
export function chooseScene({ program, programNow, stale = false } = {}) {
  if (stale) return { id: 'slate', reason: 'stale', pinned: false };
  if (!isObj(program)) return { id: 'slate', reason: 'no_program', pinned: false };
  const scene = isObj(program.scene) ? program.scene : null;
  const auto = !scene || scene.auto !== false;
  if (!auto) {
    const id = SCENE_IDS.includes(scene.id) ? scene.id : 'slate';
    if (id === 'results' && !resultsVisible(program, programNow)) {
      const fallback = autoScene(program, programNow);
      return { id: fallback.id === 'results' ? 'table' : fallback.id, reason: 'results_pending', pinned: true };
    }
    if (id === 'finalIntro' && finalTableSeats(program).length === 0) {
      return { id: 'table', reason: 'no_final_table', pinned: true };
    }
    return { id, reason: 'producer', pinned: true };
  }
  return { ...autoScene(program, programNow), pinned: false };
}

/** Scenes that show the featured table (the shell draws the table for these too). */
export const TABLE_SCENES = Object.freeze(['table', 'hfh']);
