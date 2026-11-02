/**
 * BroadcastApp — the tournament broadcast page (broadcast.html), the picture
 * OBS / the stream worker sends to Facebook (lead spec C1, 2026-11-02). It
 * loads none of the player app: no sign-in, no service worker, no update toast.
 *
 * - The runtime (net/broadcastRuntime.js) owns the /broadcast socket, the
 *   program store and the feed health; this component only draws them.
 * - The scenes are CLB's `ui/scenes/SceneSwitcher.jsx` (lead spec §2), picked
 *   up with import.meta.glob so the shell builds and runs before it lands; it
 *   receives SCENE_PROPS below. Without it the shell draws a minimal table /
 *   info card. Whatever the scene, the shell shows the slate while the feed
 *   cannot be trusted (not yet subscribed, an unknown contract version, a
 *   replaced session); a stale feed is passed down as `stale` (the scene
 *   machine shows the slate; the shell does so itself when it draws).
 * - #bc-root[data-bc-ready="1"] once the first snapshot has rendered.
 *
 * SCENE_PROPS (the contract with ui/scenes/SceneSwitcher.jsx):
 *   layout '16x9'|'9x16', motion 'full'|'reduced',
 *   program (ProgramState), table (BroadcastTableFrame|null, public frames
 *   already gated), tables (TableSummary[]), events (recent TickerEvent frames),
 *   feed (effective Feed), delayMs, onAir, stale (bool), feedHealth
 *   ('ok'|'amber'|'stale'), now (local ms, 4 Hz), serverNow / programNow
 *   (estimated server and program clocks at `now`), TableView (BroadcastTable:
 *   pass {table, feed, layout, serverNow, programNow}), onSceneShown(id) (call
 *   it from an effect: the scene on screen, for health() and the reload rule).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Stage from './ui/Stage.jsx';
import BroadcastErrorBoundary, { ShellSlate } from './ui/BroadcastErrorBoundary.jsx';
import LiveTally from './ui/LiveTally.jsx';
import BroadcastTable from './ui/table/BroadcastTable.jsx';
import { estimateServerNow, estimateProgramNow } from './model/programStore.js';
import { shellSceneOf } from './net/broadcastRuntime.js';
import { LEGAL_LINE } from './model/contract.js';
import { formatChips } from './model/tableFormat.js';

// CLB's scene switcher, when it is in the tree (eager: no extra request).
const SCENE_MODULES = import.meta.glob('./ui/scenes/SceneSwitcher.jsx', { eager: true });
const SceneSwitcher = Object.values(SCENE_MODULES).map((m) => m && m.default).find(Boolean) || null;

const TICK_MS = 250;

function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const DENVER = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
})();

function denverText(ms) {
  if (!Number.isFinite(ms) || !DENVER) return '';
  return `${DENVER.format(new Date(ms))} MT`;
}

const STATUS_TEXT = {
  scheduled: 'Starts',
  registering: 'Registration open',
  tables_open: 'Tables open',
  running: 'Live now',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

/** The shell's own scenes, used only when CLB's SceneSwitcher is not in the build. */
function ShellScene({ program, table, feed, layout, stale, serverNow, programNow }) {
  const legal = (program && program.legal && program.legal.line) || LEGAL_LINE;
  if (stale) return <ShellSlate reason="stale" legal={legal} />;
  const ev = program && program.event ? program.event : {};
  const title = ev.title || ev.name || 'American Pub Poker';
  const sceneId = program && program.scene ? program.scene.id : 'slate';
  if (sceneId === 'slate') return <ShellSlate reason="producer" legal={legal} />;
  if (table && (sceneId === 'table' || sceneId === 'hfh' || sceneId === 'finalIntro' || sceneId === 'room')) {
    const st = program.standings || {};
    return (
      <>
        <div className="bc-shell-topbar">
          <div className="bc-shell-topbar__title">{title}</div>
          {Number.isFinite(st.playersLeft) ? <div className="bc-shell-topbar__item">{st.playersLeft} left</div> : null}
          {Number.isFinite(st.avgStack) ? <div className="bc-shell-topbar__item bc-shell-topbar__item--mut">Avg {formatChips(st.avgStack)}</div> : null}
        </div>
        <div className="bc-shell-table-box">
          <BroadcastTable table={table} feed={feed} layout={layout} serverNow={serverNow} programNow={programNow} />
        </div>
        <div className="bc-shell-legal">{legal}</div>
      </>
    );
  }
  const status = STATUS_TEXT[ev.status] || '';
  const when = ev.status === 'scheduled' || ev.status === 'registering' || ev.status === 'tables_open'
    ? denverText(ev.dealsAt || ev.scheduledAt) : '';
  const left = program && program.standings && Number.isFinite(program.standings.playersLeft)
    ? `${program.standings.playersLeft} players left` : '';
  return (
    <>
      <div className="bc-shell-card">
        <div className="bc-shell-card__kicker">{status || 'American Pub Poker'}</div>
        <div className="bc-shell-card__title">{title}</div>
        {when || left ? <div className="bc-shell-card__line">{[when, left].filter(Boolean).join(' · ')}</div> : null}
      </div>
      <div className="bc-shell-legal">{legal}</div>
    </>
  );
}

/**
 * The picture for a program store state — the page, and (later) the producer
 * panel's program monitor (fit='parent' or a fixed scale).
 */
export function BroadcastProgramView({
  programState, feedHealth = 'ok', layout = '16x9', bg = 'opaque', motion = 'full',
  fit = 'window', scale = null, now, onSceneShown, overlay = null,
}) {
  const p = programState;
  const stale = feedHealth === 'stale';
  const serverNow = estimateServerNow(p, now);
  const programNow = estimateProgramNow(p, now);
  const legal = (p.program && p.program.legal && p.program.legal.line) || LEGAL_LINE;
  let body;
  if (p.unsupported) body = <ShellSlate reason="version_unsupported" legal={legal} />;
  else if (!p.ready) body = <ShellSlate reason="connecting" legal={legal} />;
  else {
    const sceneProps = {
      layout, motion, program: p.program, table: p.table, tables: p.tables, events: p.events,
      feed: p.feed, delayMs: p.delayMs, onAir: p.onAir, stale, feedHealth,
      now, serverNow, programNow, TableView: BroadcastTable, onSceneShown,
    };
    body = SceneSwitcher ? <SceneSwitcher {...sceneProps} /> : <ShellScene {...sceneProps} />;
  }
  return (
    <Stage layout={layout} bg={bg} motion={motion} fit={fit} scale={scale} stale={stale}>
      <BroadcastErrorBoundary legal={legal}>{body}</BroadcastErrorBoundary>
      {overlay}
    </Stage>
  );
}

export default function BroadcastApp({ runtime, config }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState);
  const now = useNow(TICK_MS);
  const ready = state.program.ready && !state.program.unsupported;

  // Readiness for the stream worker / Playwright: set once, never cleared.
  useEffect(() => {
    if (!ready) return;
    const root = document.getElementById('bc-root');
    if (root) root.setAttribute('data-bc-ready', '1');
    runtime.markReady();
  }, [ready, runtime]);

  // The scene on screen, for health() and the reload rule. A scene switcher
  // that reports its own choice wins over the shell's.
  const [reported, setReported] = useState(null);
  const onSceneShown = useCallback((id) => setReported(typeof id === 'string' ? id : null), []);
  const shellScene = shellSceneOf(state);
  const shown = shellScene === 'slate' || !SceneSwitcher ? shellScene : (reported || shellScene);
  useEffect(() => { runtime.setShownScene(shown); }, [runtime, shown]);

  const identify = state.identifyUntil > now
    ? (
      <div className="bc-identify">
        {(config.event || `Channel ${config.channel}`)} · {config.layout === '9x16' ? '9:16' : '16:9'}{config.role === 'output' ? ' · output' : ''}
      </div>
    )
    : null;

  if (state.socket.replaced) {
    return (
      <Stage layout={config.layout} bg={config.bg} motion={config.motion}>
        <ShellSlate reason="session_replaced" />
      </Stage>
    );
  }

  return (
    <BroadcastProgramView
      programState={state.program}
      feedHealth={state.health.status}
      layout={config.layout}
      bg={config.bg}
      motion={config.motion}
      now={now}
      onSceneShown={onSceneShown}
      overlay={(
        <>
          <LiveTally
            health={state.health.status}
            showTally={config.tally}
            onAir={state.program.onAir}
            rehearsal={!!(state.program.program && state.program.program.rehearsal)}
            keyRefused={state.socket.keyRefused}
          />
          {identify}
        </>
      )}
    />
  );
}
