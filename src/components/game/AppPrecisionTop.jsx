// APP Precision (2026-11-24) - the top area of the table skin: the stat strip
// (TOTAL POT, BLINDS, SPR or the level clock, the street with its progress
// dashes), the extras line (side pots, next level, tournament standings,
// dealer's choice next) and the one-line action ticker. GameHUD renders these
// only when cinematicEnabled (on by default; off = VITE_APP_CINEMATIC=0), inside .hud-top, from the
// same values the old top row showed: nothing new is computed here.
// Blue + gold, never red. Every help tool (SPR) arrives already gated by the
// caller on helpToolsOff.
import { useEffect, useState } from 'react';
import { useTimerStore } from '../../store/timerStore';
import {
  clockSkewMs, levelRemainingMs, levelBarFraction, levelBarColor, formatClock,
  formatSecondsClock, standingsParts,
} from '../../utils/tournamentClock';

const chips = (n) => Number(n || 0).toLocaleString('en-US');
// Compact only above 7 digits (10,000,000 -> 10.0M); the full value is in the title.
const compact = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e7) return `${(v / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1)}M`;
  return chips(v);
};
// A strip value shrinks to fit its panel (CSS: 100cqi / characters, 11-19px).
const fit = (text) => ({ '--app-chars': Math.max(3, String(text).length) });

// One dash per street of the variant (the server's phase names).
const STREETS_HOLDEM = ['PreFlop', 'Flop', 'Turn', 'River', 'Showdown'];
const STREETS_STUD = ['ThirdStreet', 'FourthStreet', 'FifthStreet', 'SixthStreet', 'SeventhStreet'];
// Draw games bet first in the PreFlop phase (poker-server FiveCardDrawTable).
const STREETS_DRAW1 = ['PreFlop', 'Draw1', 'Bet2'];
const STREETS_DRAW3 = ['PreFlop', 'Draw1', 'Bet2', 'Draw2', 'Bet3', 'Draw3', 'Bet4'];

function streetProgress({ phase, isStudGame, hasDrawPhase, variant }) {
  const seq = isStudGame ? STREETS_STUD
    : hasDrawPhase ? (variant === 'triple-draw' || variant === 'badugi' ? STREETS_DRAW3 : STREETS_DRAW1)
      : STREETS_HOLDEM;
  if (phase === 'Showdown' || phase === 'HandComplete') return { total: seq.length, lit: seq.length };
  const p = hasDrawPhase && (phase === 'Deal' || phase === 'Bet1') ? 'PreFlop' : phase;
  const i = seq.indexOf(p);
  return { total: seq.length, lit: i >= 0 ? i + 1 : 0 };
}

// The strip's short street words (the full phase label is the panel's title).
const SHORT_STREET = {
  WaitingForPlayers: 'Waiting', HandComplete: 'Hand over',
  Bet1: 'Bet 1', Bet2: 'Bet 2', Bet3: 'Bet 3', Bet4: 'Bet 4',
  ThirdStreet: '3rd St', FourthStreet: '4th St', FifthStreet: '5th St', SixthStreet: '6th St', SeventhStreet: '7th St',
};

const TICK_MS = 500;
function useLocalNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Panel({ kind, label, title, children, footer }) {
  return (
    <div className={`app-strip__panel app-strip__panel--${kind}`} title={title || undefined}>
      {label != null && <span className="app-strip__label">{label}</span>}
      {children}
      {footer}
    </div>
  );
}

/** The tournament level clock (ticks locally from levelEndsAt, like TournamentClockStrip). */
function LevelClockPanel({ clock }) {
  const fallbackSkew = useTimerStore((s) => s.clockSkewMs);
  const now = useLocalNow();
  const skew = clockSkewMs(clock, fallbackSkew);
  const remaining = levelRemainingMs(clock, now, skew);
  const frac = levelBarFraction(clock, remaining);
  const color = levelBarColor(remaining, clock.durationMs);
  const full = clock.level ? (clock.levels ? `Level ${clock.level}/${clock.levels}` : `Level ${clock.level}`) : 'Level';
  // the panel is narrow on phones: "LVL 6/20" (the title says it in full)
  const label = clock.level ? (clock.levels ? `Lvl ${clock.level}/${clock.levels}` : `Level ${clock.level}`) : 'Level';
  const value = remaining != null ? formatClock(remaining) : (clock.paused ? 'Paused' : '-');
  return (
    <Panel kind="level" label={label} title={`${full}${remaining != null ? ` · ${value} left` : ''}`}>
      <span className="app-strip__value app-strip__value--clock" role="timer" aria-live="off" style={fit(value)}>{value}</span>
      {frac != null && (
        <span className="app-strip__bar" aria-hidden="true">
          <span className="app-strip__bar-fill" style={{ width: `${(frac * 100).toFixed(1)}%`, background: color }} />
        </span>
      )}
    </Panel>
  );
}

/** The old blind-level widget (gameState.blindLevel / nextBlindIn) as the LEVEL panel. */
function BlindTimerPanel({ timer }) {
  const pct = Math.min(100, (timer.nextIn / (timer.duration || 600)) * 100);
  // Same colours as the old bar (no red): the last 30s amber, 30-60s gold.
  const color = timer.nextIn < 30 ? '#f59e0b' : timer.nextIn < 60 ? '#ffd24a' : '#4ade80';
  const value = formatSecondsClock(timer.nextIn);
  return (
    <Panel kind="level" label={`Level ${timer.level}`} title={`Level ${timer.level} · Next in ${value}`}>
      <span className="app-strip__value app-strip__value--clock" style={fit(value)}>{value}</span>
      <span className="app-strip__bar" aria-hidden="true">
        <span className="app-strip__bar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
    </Panel>
  );
}

export function AppStatStrip({
  pot, potFlashing, sb, bb, ante, extras, spr, clock, blindTimer,
  phase, phaseLabel, variantLabel, isStudGame, hasDrawPhase, variant,
}) {
  // the ante's line moves to the extras line when that line shows (see hasTopExtras)
  const anteInExtras = ante > 0 && hasTopExtras(extras);
  const hasLevel = !!(clock || blindTimer);
  const sprShown = spr != null && Number.isFinite(spr);
  // The 3rd slot: the level clock (tournaments) or SPR (help tool); SPR moves
  // under TOTAL POT when the clock takes the slot; no 3rd panel when neither.
  const third = hasLevel ? 'level' : sprShown ? 'spr' : null;
  const sprTier = sprShown ? (spr < 3 ? 'low' : spr < 8 ? 'mid' : 'high') : '';
  const street = SHORT_STREET[phase] || phaseLabel || '';
  const prog = streetProgress({ phase, isStudGame, hasDrawPhase, variant });
  const blindsText = `${compact(sb)} / ${compact(bb)}`;
  return (
    <div className={`app-strip app-strip--${third ? `four app-strip--${third}` : 'three'}${variantLabel ? ' app-strip--variant' : ''}`} role="group" aria-label="Table stats">
      <Panel kind="pot" label="Total pot" title={`Total pot ${chips(pot)}`}>
        <span className={`app-strip__value app-strip__value--gold${potFlashing ? ' app-strip__value--flash' : ''}`} style={fit(compact(pot))}>
          <span className="app-strip__chip" aria-hidden="true" />
          <span className="app-strip__num">{compact(pot)}</span>
        </span>
        {third === 'level' && sprShown && (
          <span className={`app-strip__sub app-strip__sub--spr app-spr--${sprTier}`}>SPR {spr.toFixed(1)}</span>
        )}
      </Panel>
      <Panel kind="blinds" label="Blinds" title={`Blinds ${chips(sb)} / ${chips(bb)}${ante > 0 ? ` · ante ${chips(ante)}` : ''}`}>
        <span className="app-strip__value" style={fit(blindsText)}>{blindsText}</span>
        {ante > 0 && !anteInExtras && <span className="app-strip__sub">Ante {compact(ante)}</span>}
      </Panel>
      {third === 'spr' && (
        <Panel kind="spr" label="SPR" title={`Stack to pot ratio ${spr.toFixed(1)}`}>
          <span className={`app-strip__value app-spr--${sprTier}`} style={fit(spr.toFixed(1))}>{spr.toFixed(1)}</span>
        </Panel>
      )}
      {third === 'level' && (clock ? <LevelClockPanel clock={clock} /> : <BlindTimerPanel timer={blindTimer} />)}
      <Panel kind="street" label={null} title={`${variantLabel ? `${variantLabel} · ` : ''}${phaseLabel || ''}`}>
        {variantLabel && <span className="app-strip__variant">{variantLabel}</span>}
        <span className="app-strip__street" data-phase={phase || ''}>{street}</span>
        <span className="app-strip__dashes" aria-label={`Street ${prog.lit} of ${prog.total}`} role="img">
          {Array.from({ length: prog.total }, (_, i) => (
            <i key={i} className={i < prog.lit ? 'app-dash app-dash--on' : 'app-dash'} />
          ))}
        </span>
      </Panel>
    </div>
  );
}

// The words the old clock strip said after its countdown (same rules as
// utils/tournamentClock clockStripParts), plus its standings line.
// handNext (pre-ship review): the hand's own "Next: 150/300" shows (the level
// rose mid-hand), so the clock's "next" (the level AFTER that one) is left
// out: two different "next" values side by side would skip a level.
function clockExtras(clock, handNext) {
  if (!clock) return [];
  const out = [];
  const atTop = !!(clock.levels && clock.level && clock.level >= clock.levels);
  if (atTop) out.push({ k: 'final', t: 'final level' });
  else if (!handNext && clock.next && clock.next.bb) out.push({ k: 'next', t: `next ${chips(clock.next.sb)}/${chips(clock.next.bb)}`, cls: 'app-info__next' });
  if (clock.paused) {
    const r = clock.pauseReason;
    out.push({ k: 'status', t: r === 'prestart' ? 'not started' : r === 'break' ? 'on break' : r === 'held' ? 'on hold' : 'clock paused', cls: 'app-info__status' });
  }
  const st = standingsParts(clock);
  if (st) {
    // the average stack drops first on narrow phones (as the old strip did)
    if (st.left) out.push({ k: 'st-left', t: st.left });
    if (st.avg) out.push({ k: 'st-avg', t: st.avg, item: 'app-info__item--avg' });
    if (st.paid) out.push({ k: 'st-paid', t: st.paid });
  }
  return out;
}

/**
 * Whether the extras line has anything to show (side pots, next level, the
 * clock's words / standings, dealer's choice next). When it has, the ante
 * rides at its start instead of a second line under BLINDS (APP Precision
 * repair: one line less in the top bar at tournament tables).
 */
function hasTopExtras({ pots, nextLevel, clock, dcNext } = {}) {
  return !!((Array.isArray(pots) && pots.length >= 2) || nextLevel || dcNext || clockExtras(clock, !!nextLevel).length);
}

/** The ante (see hasTopExtras), side pots, the next blind level, tournament standings, dealer's choice next. Nothing when none. */
export function AppTopExtras({ ante, pots, nextLevel, clock, dcNext }) {
  const items = [];
  if (ante > 0 && hasTopExtras({ pots, nextLevel, clock, dcNext })) {
    items.push({ k: 'ante', node: <span className="app-info__ante">ante {chips(ante)}</span> });
  }
  if (Array.isArray(pots) && pots.length >= 2) {
    pots.forEach((p, i) => items.push({
      k: `pot-${p.name}`,
      node: <span className={`app-info__pot${i === 0 ? ' app-info__pot--main' : ''}`}>{p.name}: {chips(p.amount)}</span>,
    }));
  }
  if (nextLevel) items.push({ k: 'next-level', node: <span className="app-info__next">{nextLevel}</span> });
  clockExtras(clock, !!nextLevel).forEach((e) => items.push({ k: e.k, item: e.item, node: <span className={e.cls || undefined}>{e.t}</span> }));
  if (dcNext) items.push({ k: 'dc-next', node: <span className="app-info__dc">Next: {dcNext}</span> });
  if (!items.length) return null;
  // One line (APP Precision repair): a line longer than the screen scrolls sideways.
  return (
    <div className="app-info">
      {items.map((it, i) => (
        <span key={it.k} className={`app-info__item${it.item ? ` ${it.item}` : ''}`}>{i > 0 && <span className="app-info__sep" aria-hidden="true">·</span>}{it.node}</span>
      ))}
    </div>
  );
}

/**
 * The live action history (newest first, as GameHUD keeps it) on one line that
 * reads oldest -> newest; when it does not fit, the oldest end fades out. The
 * leading dot is the connection dot. The row is reserved even when empty.
 */
export function AppTicker({ entries, isBetEntry, connStatus, connTitle, watching }) {
  return (
    <div className="app-ticker" aria-label="Last actions">
      <span className={`conn-dot conn-dot--${connStatus} app-ticker__dot`} title={connTitle} />
      {watching && <span className="app-ticker__watching">Watching</span>}
      <div className="app-ticker__items">
        {entries.map((a, i) => (
          <span
            key={`${i}-${a}`}
            className={`app-ticker__item${i === 0 ? ' app-ticker__item--latest' : ''}${isBetEntry && isBetEntry(a) ? ' app-ticker__item--bet' : ''}`}
          >{a}</span>
        ))}
      </div>
    </div>
  );
}
