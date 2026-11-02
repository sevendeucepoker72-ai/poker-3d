/**
 * The broadcast page's runtime (lead spec C1 + R6 + R9, 2026-11-02): one
 * object that owns the /broadcast socket, the program store, the feed health
 * and the stream worker's health contract. Plain JS outside React, so a frame
 * that reveals a seq gap asks for `bc:resync` at once (never one render late),
 * and node:test drives it with a fake io. React reads it through
 * useSyncExternalStore (BroadcastApp).
 *
 * Worker contract (§3): window.__apkBroadcast.health() =
 *   {ready, socketConnected, feedAgeMs, scene, eventKey, tournamentId, tableId,
 *    eventStatus, playersLeft, feedMode}
 * Producer commands (`bc:command`): 'reload' is honoured only while the scene
 * on screen is the slate or the break; 'identify' shows the source's channel
 * and layout for 5 s.
 */
import { createBroadcastSocket } from './broadcastSocket.js';
import {
  initialProgramState, applySnapshot, applyFrame, applyHeartbeat, markResyncSent,
} from '../model/programStore.js';
import { initialFeedHealth, onBeat, evaluateFeedHealth } from '../model/feedHealth.js';
import { isObj } from '../model/contract.js';

export const BROADCAST_PAGE_VERSION = '1.0.0';
export const HEALTH_TICK_MS = 250;
export const IDENTIFY_MS = 5000;
export const RELOAD_SCENES = Object.freeze(['slate', 'break']);

/** The scene the shell itself would show: the slate whenever the feed cannot be trusted. */
export function shellSceneOf(state) {
  const p = state.program;
  if (state.socket.replaced || p.unsupported || !p.ready || state.health.status === 'stale') return 'slate';
  return p.program && p.program.scene ? p.program.scene.id : 'slate';
}

export function createBroadcastRuntime(opts) {
  const { io, serverUrl, config } = opts;
  const clock = opts.now || (() => Date.now());
  const setI = opts.setInterval || setInterval;
  const clearI = opts.clearInterval || clearInterval;
  const reload = opts.reload || (() => {});
  const log = opts.log;
  const listeners = new Set();

  let state = {
    program: initialProgramState(),
    health: initialFeedHealth(),
    socket: { connected: false, subscribed: false, keyed: !!config.key, keyRefused: null, keyHeld: null, refused: null, replaced: false },
    identifyUntil: 0,
    lastCommand: null,
  };
  const startedAt = clock();
  let sock = null;
  let tick = null;
  let readyMarked = false;
  let shownScene = null;

  function set(next) {
    if (next === state) return;
    state = next;
    for (const l of listeners) {
      try { l(); } catch { /* a listener never breaks the feed */ }
    }
  }

  function maybeResync(program) {
    if (!program.needsResync || !sock) return program;
    return sock.resync(program.resyncReason || 'seq_gap') ? markResyncSent(program) : program;
  }

  function onSnapshot(snap) {
    const t = clock();
    const program = applySnapshot(state.program, snap, t);
    set({ ...state, program, health: onBeat(state.health, t) });
  }

  function onFrame(frame) {
    const program = maybeResync(applyFrame(state.program, frame, clock()));
    if (program !== state.program) set({ ...state, program });
  }

  function onHeartbeat(hb) {
    const t = clock();
    const program = maybeResync(applyHeartbeat(state.program, hb, t));
    set({ ...state, program, health: onBeat(state.health, t) });
  }

  function onCommand(cmd) {
    if (!isObj(cmd) || typeof cmd.cmd !== 'string') return;
    const t = clock();
    const scene = shownScene || shellSceneOf(state);
    if (cmd.cmd === 'identify') {
      set({ ...state, identifyUntil: t + IDENTIFY_MS, lastCommand: { cmd: 'identify', id: cmd.id ?? null, at: t, done: true } });
      return;
    }
    if (cmd.cmd === 'reload') {
      const allowed = RELOAD_SCENES.includes(scene);
      set({ ...state, lastCommand: { cmd: 'reload', id: cmd.id ?? null, at: t, done: allowed, scene } });
      if (allowed) {
        try { reload(); } catch { /* ignore */ }
      }
    }
  }

  const api = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (sock) return api;
      sock = createBroadcastSocket({
        io,
        serverUrl,
        config,
        log,
        now: clock,
        setTimeout: opts.setTimeout,
        clearTimeout: opts.clearTimeout,
        getLastSeq: () => (state.program.ready ? state.program.seq : null),
        on: {
          snapshot: onSnapshot,
          frame: onFrame,
          heartbeat: onHeartbeat,
          command: onCommand,
          status: (s) => set({ ...state, socket: { ...state.socket, ...s } }),
        },
      });
      tick = setI(() => {
        const health = evaluateFeedHealth(state.health, clock());
        if (health !== state.health) set({ ...state, health });
      }, HEALTH_TICK_MS);
      return api;
    },
    stop() {
      if (tick) clearI(tick);
      tick = null;
      if (sock) sock.close();
      sock = null;
    },
    /** The page marked #bc-root[data-bc-ready="1"] (first snapshot rendered). */
    markReady() { readyMarked = true; },
    /** The scene actually on screen (the scene switcher reports it). */
    setShownScene(id) { shownScene = typeof id === 'string' ? id : null; },
    /** The stream worker's health contract (spec §3), polled every 5 s. */
    health() {
      const t = clock();
      const p = state.program;
      const program = p.program || null;
      const event = program && isObj(program.event) ? program.event : null;
      const lastBeat = state.health.lastBeatAt;
      return {
        ready: readyMarked,
        socketConnected: !!state.socket.connected,
        feedAgeMs: Math.max(0, t - (lastBeat === null ? startedAt : lastBeat)),
        scene: shownScene || shellSceneOf(state),
        eventKey: program && typeof program.eventKey === 'string' ? program.eventKey : null,
        tournamentId: event && event.tournamentId ? event.tournamentId : null,
        tableId: (p.table && p.table.tableId) || (program && program.featured && program.featured.tableId) || null,
        eventStatus: event && typeof event.status === 'string' ? event.status : null,
        playersLeft: program && program.standings && Number.isFinite(program.standings.playersLeft)
          ? program.standings.playersLeft : null,
        feedMode: p.feed.mode,
      };
    },
  };
  return api;
}
