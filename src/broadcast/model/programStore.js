/**
 * Broadcast program store — a pure reducer over the /broadcast stream (lead
 * spec §3 + R10, 2026-11-01). Every frame REPLACES the object it carries
 * (program / table), never merges. One `seq` per subscription stream: a frame
 * at or below the current seq is ignored (older than the snapshot, or a
 * duplicate); a jump of more than one, or a heartbeat ahead of us, marks
 * `needsResync` so the socket sends `bc:resync` ('[broadcast] resync').
 *
 * Buffers are bounded (ticker and events 30, table summaries 64), so a 6-hour
 * run holds the same memory as the first minute.
 *
 * On a PUBLIC feed every table frame passes through holeCardGate.publicTableFrame
 * here, so no component can draw a live hole card even if it skips HoleCam.
 * A delayed feed keeps its cards for the render-time gate (it needs the clock).
 */
import { isObj, versionSupported, SCENE_IDS } from './contract.js';
import { effectiveFeed, publicTableFrame } from './holeCardGate.js';

export const TICKER_MAX = 30;
export const EVENTS_MAX = 30;
export const TABLES_MAX = 64;

export const RESYNC_LOG = '[broadcast] resync';

export function initialProgramState() {
  return {
    ready: false,          // a snapshot has been applied
    unsupported: false,    // an unknown major version arrived: the page shows the slate
    seq: -1,
    serverNow: null,       // server ms of the last snapshot / heartbeat
    receivedAt: null,      // local ms it arrived
    skewMs: 0,             // serverNow - local now
    programNow: null,      // program ms at receivedAt (serverNow - delayMs on a delayed feed)
    delayMs: 0,
    onAir: false,
    feed: { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' },
    program: null,
    table: null,
    tables: [],
    events: [],
    needsResync: false,
    resyncReason: null,
    lastFrameAt: null,     // local ms of the last snapshot / frame / heartbeat
    frames: 0,
  };
}

function tail(list, max) {
  return list.length > max ? list.slice(list.length - max) : list;
}

/** The program as stored: a bounded ticker, a known scene id. */
export function normalizeProgram(program) {
  if (!isObj(program)) return null;
  const ticker = Array.isArray(program.ticker) ? tail(program.ticker.filter(isObj), TICKER_MAX) : [];
  const scene = isObj(program.scene) ? program.scene : { id: 'slate', auto: true, since: 0 };
  const sceneId = SCENE_IDS.includes(scene.id) ? scene.id : 'slate';
  if (ticker === program.ticker && sceneId === scene.id) return program;
  return { ...program, ticker, scene: { ...scene, id: sceneId } };
}

function storeTable(table, feed) {
  if (!isObj(table)) return null;
  return feed.mode === 'delayed' ? table : publicTableFrame(table);
}

function clockFrom(state, serverNow, programNow, localNow) {
  if (!Number.isFinite(serverNow)) return {};
  return {
    serverNow,
    receivedAt: localNow,
    skewMs: serverNow - localNow,
    programNow: Number.isFinite(programNow) ? programNow : serverNow - (state.delayMs || 0),
  };
}

/** Apply a `bc:snapshot` (also the ack of `bc:subscribe`). Replaces everything. */
export function applySnapshot(state, snap, localNow) {
  if (!isObj(snap)) return state;
  if (!versionSupported(snap)) return { ...state, unsupported: true, lastFrameAt: localNow };
  const program = normalizeProgram(snap.program);
  const feed = effectiveFeed(snap.feed, program && program.feed);
  const delayMs = feed.mode === 'delayed' ? feed.delayMs : 0;
  const base = { ...state, delayMs };
  return {
    ...base,
    ...clockFrom(base, snap.serverNow, program && program.programNow, localNow),
    ready: true,
    unsupported: false,
    seq: Number.isInteger(snap.seq) ? snap.seq : state.seq,
    feed,
    program,
    onAir: !!(program && program.onAir),
    table: storeTable(snap.table, feed),
    tables: Array.isArray(snap.tables) ? snap.tables.filter(isObj).slice(0, TABLES_MAX) : [],
    events: [],
    needsResync: false,
    resyncReason: null,
    lastFrameAt: localNow,
    frames: state.frames + 1,
  };
}

/** Apply a `bc:frame`. Ignores stale / duplicate seqs; flags a gap. */
export function applyFrame(state, frame, localNow) {
  if (!isObj(frame) || !state.ready) return state;
  if (!versionSupported(frame, { required: false })) return { ...state, unsupported: true, lastFrameAt: localNow };
  const seq = frame.seq;
  if (!Number.isInteger(seq) || seq <= state.seq) return state;
  const gap = seq > state.seq + 1;
  const next = {
    ...state,
    seq,
    lastFrameAt: localNow,
    frames: state.frames + 1,
    needsResync: state.needsResync || gap,
    resyncReason: gap ? 'seq_gap' : state.resyncReason,
  };
  if (frame.kind === 'program' && isObj(frame.program)) {
    const program = normalizeProgram(frame.program);
    next.program = program;
    next.onAir = !!program.onAir;
    if (isObj(program.feed)) next.feed = effectiveFeed(state.feed, program.feed);
  } else if (frame.kind === 'table') {
    next.table = storeTable(frame.table, next.feed);
  } else if (frame.kind === 'event' && isObj(frame.event)) {
    const ev = frame.event;
    if (!(ev.id !== undefined && state.events.some((e) => e.id === ev.id))) {
      next.events = tail([...state.events, ev], EVENTS_MAX);
    }
  }
  return next;
}

/** Apply a `bc:heartbeat` {seq, serverNow, programNow, delayMs, onAir}. */
export function applyHeartbeat(state, hb, localNow) {
  if (!isObj(hb)) return state;
  const delayMs = Number.isFinite(hb.delayMs) && hb.delayMs >= 0 ? hb.delayMs : state.delayMs;
  const next = {
    ...state,
    ...clockFrom({ delayMs }, hb.serverNow, hb.programNow, localNow),
    delayMs,
    lastFrameAt: localNow,
  };
  if (typeof hb.onAir === 'boolean') next.onAir = hb.onAir;
  // The server is ahead of us: frames were lost (e.g. during a reconnect).
  if (state.ready && Number.isInteger(hb.seq) && hb.seq > state.seq) {
    next.needsResync = true;
    next.resyncReason = 'heartbeat_ahead';
  }
  return next;
}

/** The resync request went out: clear the flag (a fresh snapshot follows). */
export function markResyncSent(state) {
  return state.needsResync ? { ...state, needsResync: false } : state;
}

/** The page's estimate of the server clock at local time `localNow`. */
export function estimateServerNow(state, localNow) {
  if (!Number.isFinite(state.serverNow) || !Number.isFinite(state.receivedAt)) return NaN;
  return state.serverNow + (localNow - state.receivedAt);
}

/** The program clock (what is on screen) at local time `localNow`. */
export function estimateProgramNow(state, localNow) {
  if (!Number.isFinite(state.programNow) || !Number.isFinite(state.receivedAt)) return NaN;
  return state.programNow + (localNow - state.receivedAt);
}

/** One reducer for every stream message. */
export function reduceProgram(state, action) {
  const now = Number.isFinite(action.localNow) ? action.localNow : Date.now();
  switch (action.type) {
    case 'snapshot': return applySnapshot(state, action.payload, now);
    case 'frame': return applyFrame(state, action.payload, now);
    case 'heartbeat': return applyHeartbeat(state, action.payload, now);
    case 'resyncSent': return markResyncSent(state);
    case 'reset': return initialProgramState();
    default: return state;
  }
}
