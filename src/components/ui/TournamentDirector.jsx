import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './TournamentDirector.css';

// ── Blind schedule templates ──────────────────────────────────────────────────

const BASE_LEVELS = [
  { sb: 10, bb: 20, ante: 0 },
  { sb: 15, bb: 30, ante: 0 },
  { sb: 25, bb: 50, ante: 0 },
  { sb: 50, bb: 100, ante: 10 },
  { sb: 75, bb: 150, ante: 15 },
  { sb: 100, bb: 200, ante: 25 },
  { sb: 150, bb: 300, ante: 35 },
  { sb: 200, bb: 400, ante: 50 },
  { sb: 300, bb: 600, ante: 75 },
  { sb: 400, bb: 800, ante: 100 },
  { sb: 600, bb: 1200, ante: 150 },
  { sb: 1000, bb: 2000, ante: 250 },
];

const TEMPLATES = {
  'Standard (15min)': 15,
  'Turbo (8min)': 8,
  'Hyper-Turbo (4min)': 4,
  'Deep Stack (20min)': 20,
};

function generateSchedule(durationMins) {
  return BASE_LEVELS.map((l, i) => ({ ...l, duration: durationMins, level: i + 1 }));
}

// ── ICM Calculator ────────────────────────────────────────────────────────────

/**
 * Malmuth-Harville simplified ICM:
 * P(player i finishes 1st) = chips_i / total_chips
 * P(player i finishes 2nd | j finished 1st) = chips_i / (total - chips_j)
 * etc.
 */
function computeICM(chipCounts, prizePool, prizePercents) {
  const n = chipCounts.length;
  const total = chipCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return chipCounts.map(() => 0);

  const prizes = prizePercents.map(p => (p / 100) * prizePool);
  const equity = new Array(n).fill(0);

  // Enumerate all permutations of finishing positions up to the number of paid spots
  const paidSpots = prizes.filter(p => p > 0).length;

  function recurse(remaining, prob, chips, depth) {
    if (depth >= paidSpots) return;
    const poolLeft = chips.reduce((a, b) => a + b, 0);
    if (poolLeft === 0) return;

    remaining.forEach(i => {
      const p1 = chips[i] / poolLeft;
      equity[i] += prob * p1 * prizes[depth];

      const newChips = [...chips];
      newChips[i] = 0;
      const newRemaining = remaining.filter(x => x !== i);
      recurse(newRemaining, prob * p1, newChips, depth + 1);
    });
  }

  const indices = chipCounts.map((_, i) => i);
  recurse(indices, 1, [...chipCounts], 0);

  return equity;
}

// ── ICM Calculator UI ─────────────────────────────────────────────────────────

function ICMCalculator() {
  const [open, setOpen] = useState(false);
  const [playerCount, setPlayerCount] = useState(4);
  const [chips, setChips] = useState(Array(9).fill(''));
  const [prizePool, setPrizePool] = useState('10000');
  const [pct1, setPct1] = useState('50');
  const [pct2, setPct2] = useState('30');
  const [pct3, setPct3] = useState('20');

  const results = useMemo(() => {
    const chipVals = chips.slice(0, playerCount).map(c => parseFloat(c) || 0);
    const pp = parseFloat(prizePool) || 0;
    const percents = [parseFloat(pct1) || 0, parseFloat(pct2) || 0, parseFloat(pct3) || 0];

    if (chipVals.every(v => v === 0) || pp === 0) return null;

    const equity = computeICM(chipVals, pp, percents);
    return chipVals.map((c, i) => ({
      seat: i + 1,
      chips: c,
      equity: equity[i],
      pct: pp > 0 ? (equity[i] / pp) * 100 : 0,
    }));
  }, [chips, playerCount, prizePool, pct1, pct2, pct3]);

  const totalPct = (parseFloat(pct1) || 0) + (parseFloat(pct2) || 0) + (parseFloat(pct3) || 0);

  return (
    <div className="td-icm-wrap">
      <button className="td-icm-toggle" onClick={() => setOpen(o => !o)}>
        <span>ICM Calculator</span>
        <span className="td-icm-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="td-icm-body">
          <p className="td-icm-desc">
            Malmuth-Harville model. Enter chip counts and prize pool to see each player's ICM equity.
          </p>

          <div className="td-icm-row">
            <label className="td-label">
              Players
              <select className="td-select td-select-sm" value={playerCount} onChange={e => setPlayerCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="td-label">
              Prize Pool ($)
              <input className="td-input td-input-sm" type="number" value={prizePool} onChange={e => setPrizePool(e.target.value)} />
            </label>
          </div>

          <div className="td-icm-prizes">
            {[['1st %', pct1, setPct1], ['2nd %', pct2, setPct2], ['3rd %', pct3, setPct3]].map(([label, val, setter]) => (
              <label key={label} className="td-label">
                {label}
                <input className="td-input td-input-sm" type="number" min="0" max="100" value={val}
                  onChange={e => setter(e.target.value)} />
              </label>
            ))}
            <span className={`td-icm-total ${Math.abs(totalPct - 100) > 0.01 ? 'td-icm-total-warn' : ''}`}>
              Total: {totalPct.toFixed(0)}%
            </span>
          </div>

          <div className="td-icm-chips-grid">
            {Array.from({ length: playerCount }, (_, i) => (
              <label key={i} className="td-label">
                Player {i + 1} chips
                <input
                  className="td-input td-input-sm"
                  type="number"
                  placeholder="0"
                  value={chips[i]}
                  onChange={e => {
                    const next = [...chips];
                    next[i] = e.target.value;
                    setChips(next);
                  }}
                />
              </label>
            ))}
          </div>

          {results && (
            <div className="td-icm-results">
              <div className="td-icm-results-header">
                <span>Player</span>
                <span>Chips</span>
                <span>ICM Equity ($)</span>
                <span>Equity %</span>
              </div>
              {results.map(r => (
                <div key={r.seat} className="td-icm-result-row">
                  <span className="td-icm-seat">P{r.seat}</span>
                  <span>{r.chips.toLocaleString()}</span>
                  <span className="td-icm-equity">${r.equity.toFixed(2)}</span>
                  <span className="td-icm-pct">{r.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Blind Schedule Builder ────────────────────────────────────────────────────

function BlindScheduleBuilder({ schedule, onChange }) {
  const [selectedTemplate, setSelectedTemplate] = useState('Standard (15min)');

  function applyTemplate(tplName) {
    setSelectedTemplate(tplName);
    onChange(generateSchedule(TEMPLATES[tplName]));
  }

  function updateLevel(idx, field, val) {
    const next = schedule.map((l, i) => i === idx ? { ...l, [field]: Number(val) } : l);
    onChange(next);
  }

  function addLevel() {
    const last = schedule[schedule.length - 1];
    const newLevel = {
      sb: Math.round(last.sb * 1.5 / 10) * 10,
      bb: Math.round(last.bb * 1.5 / 10) * 10,
      ante: Math.round((last.ante || 0) * 1.5 / 5) * 5,
      duration: last.duration,
      level: schedule.length + 1,
    };
    onChange([...schedule, newLevel]);
  }

  function removeLevel(idx) {
    if (schedule.length <= 2) return;
    onChange(schedule.filter((_, i) => i !== idx).map((l, i) => ({ ...l, level: i + 1 })));
  }

  const estimatedMinutes = schedule.reduce((sum, l) => sum + (l.duration || 0), 0);
  const estimatedHours = (estimatedMinutes / 60).toFixed(1);

  return (
    <div className="td-section">
      <h3 className="td-section-title">Blind Schedule</h3>

      <div className="td-templates">
        {Object.keys(TEMPLATES).map(name => (
          <button
            key={name}
            className={`td-template-btn ${selectedTemplate === name ? 'td-template-active' : ''}`}
            onClick={() => applyTemplate(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="td-schedule-wrap">
        <div className="td-schedule-header">
          <span>Lvl</span>
          <span>Small Blind</span>
          <span>Big Blind</span>
          <span>Ante</span>
          <span>Duration (min)</span>
          <span></span>
        </div>
        {schedule.map((level, idx) => (
          <div key={idx} className="td-schedule-row">
            <span className="td-lvl-num">{level.level}</span>
            <input className="td-input td-input-sm" type="number" value={level.sb}
              onChange={e => updateLevel(idx, 'sb', e.target.value)} />
            <input className="td-input td-input-sm" type="number" value={level.bb}
              onChange={e => updateLevel(idx, 'bb', e.target.value)} />
            <input className="td-input td-input-sm" type="number" value={level.ante}
              onChange={e => updateLevel(idx, 'ante', e.target.value)} />
            <input className="td-input td-input-sm" type="number" value={level.duration}
              onChange={e => updateLevel(idx, 'duration', e.target.value)} />
            <button className="td-remove-btn" onClick={() => removeLevel(idx)} title="Remove level">✕</button>
          </div>
        ))}
      </div>

      <div className="td-schedule-actions">
        <button className="td-btn-secondary" onClick={addLevel}>+ Add Level</button>
        <span className="td-schedule-preview">
          {schedule.length} levels · Est. <strong>{estimatedHours}h</strong> ({estimatedMinutes}min)
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TournamentDirector({ onClose, onCreateTournament, playerName }) {
  // Basic setup
  const [name, setName] = useState(`${playerName ? playerName + "'s " : ''}Tournament`);
  const [buyIn, setBuyIn] = useState(100);
  const [maxPlayers, setMaxPlayers] = useState(9);
  const [startingChips, setStartingChips] = useState(10000);

  // Format options
  const [isPKO, setIsPKO] = useState(false);
  const [bountyAmount, setBountyAmount] = useState(50);

  const [rebuysAllowed, setRebuysAllowed] = useState(false);
  const [maxRebuys, setMaxRebuys] = useState(2);
  const [rebuyCost, setRebuyCost] = useState(100);
  const [rebuyUpTo, setRebuyUpTo] = useState(startingChips);

  const [addonAllowed, setAddonAllowed] = useState(false);
  const [addonCost, setAddonCost] = useState(100);
  const [addonChips, setAddonChips] = useState(5000);
  const [addonBeforeLevel, setAddonBeforeLevel] = useState(6);

  const [lateReg, setLateReg] = useState(3);

  // Blind schedule
  const [schedule, setSchedule] = useState(() => generateSchedule(15));

  // Close on Escape
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const handleCreate = useCallback(() => {
    const config = {
      name,
      buyIn,
      maxPlayers,
      isPKO,
      bountyAmount: isPKO ? bountyAmount : 0,
      rebuys: {
        allowed: rebuysAllowed,
        maxPerPlayer: maxRebuys,
        upTo: rebuyUpTo,
        cost: rebuyCost,
      },
      addon: {
        allowed: addonAllowed,
        cost: addonCost,
        chips: addonChips,
        beforeLevel: addonBeforeLevel,
      },
      blindSchedule: schedule.map(({ sb, bb, ante, duration }) => ({ sb, bb, ante, duration })),
      lateReg,
      startingChips,
    };
    onCreateTournament?.(config);
    onClose?.();
  }, [
    name, buyIn, maxPlayers, isPKO, bountyAmount,
    rebuysAllowed, maxRebuys, rebuyCost, rebuyUpTo,
    addonAllowed, addonCost, addonChips, addonBeforeLevel,
    lateReg, schedule, startingChips, onCreateTournament, onClose,
  ]);

  const estimatedPrizePool = buyIn * maxPlayers;

  return (
    <div className="td-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="td-modal">
        {/* Header */}
        <div className="td-header">
          <div className="td-header-left">
            <span className="td-icon">♠</span>
            <h2 className="td-title">Tournament Director</h2>
          </div>
          <button className="td-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="td-body">

          {/* ── SECTION 1: Basic Setup ── */}
          <div className="td-section">
            <h3 className="td-section-title">Basic Setup</h3>
            <div className="td-field-grid">

              <label className="td-label td-label-full">
                Tournament Name
                <input className="td-input" type="text" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
              </label>

              <label className="td-label">
                Buy-In ($)
                <input className="td-input" type="number" min={1} value={buyIn} onChange={e => setBuyIn(Number(e.target.value))} />
              </label>

              <label className="td-label">
                Max Players
                <select className="td-select" value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))}>
                  {[6, 9, 18, 27, 45, 90, 180].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>

              <label className="td-label td-label-full">
                Starting Chips: <strong className="td-strong-val">{startingChips.toLocaleString()}</strong>
                <input
                  className="td-range"
                  type="range"
                  min={1000}
                  max={50000}
                  step={1000}
                  value={startingChips}
                  onChange={e => { setStartingChips(Number(e.target.value)); setRebuyUpTo(Number(e.target.value)); }}
                />
                <div className="td-range-labels"><span>1,000</span><span>50,000</span></div>
              </label>

            </div>
            <div className="td-prize-preview">
              Est. prize pool: <strong>${estimatedPrizePool.toLocaleString()}</strong>
            </div>
          </div>

          {/* ── SECTION 2: Format Options ── */}
          <div className="td-section">
            <h3 className="td-section-title">Format Options</h3>

            {/* PKO */}
            <div className="td-toggle-row">
              <div className="td-toggle-info">
                <span className="td-toggle-label">Progressive Knockout (PKO)</span>
                <span className="td-toggle-sub">Half the bounty goes to the eliminator, half carries forward on the eliminated player's head.</span>
              </div>
              <button
                className={`td-toggle-btn ${isPKO ? 'td-toggle-on' : ''}`}
                onClick={() => setIsPKO(v => !v)}
              >
                {isPKO ? 'ON' : 'OFF'}
              </button>
            </div>
            {isPKO && (
              <div className="td-sub-options">
                <label className="td-label">
                  Starting Bounty per Player ($)
                  <input className="td-input td-input-sm" type="number" min={1} value={bountyAmount}
                    onChange={e => setBountyAmount(Number(e.target.value))} />
                </label>
                <span className="td-hint">
                  Total bounty pool: ${(bountyAmount * maxPlayers).toLocaleString()}
                </span>
              </div>
            )}

            {/* Rebuys */}
            <div className="td-toggle-row">
              <div className="td-toggle-info">
                <span className="td-toggle-label">Rebuys</span>
                <span className="td-toggle-sub">Allow players to re-enter during early levels.</span>
              </div>
              <button
                className={`td-toggle-btn ${rebuysAllowed ? 'td-toggle-on' : ''}`}
                onClick={() => setRebuysAllowed(v => !v)}
              >
                {rebuysAllowed ? 'ON' : 'OFF'}
              </button>
            </div>
            {rebuysAllowed && (
              <div className="td-sub-options td-sub-options-row">
                <label className="td-label">
                  Max per player
                  <select className="td-select td-select-sm" value={maxRebuys} onChange={e => setMaxRebuys(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="td-label">
                  Rebuy cost ($)
                  <input className="td-input td-input-sm" type="number" min={1} value={rebuyCost}
                    onChange={e => setRebuyCost(Number(e.target.value))} />
                </label>
                <label className="td-label">
                  Rebuy up to (chips)
                  <input className="td-input td-input-sm" type="number" min={1} value={rebuyUpTo}
                    onChange={e => setRebuyUpTo(Number(e.target.value))} />
                </label>
              </div>
            )}

            {/* Add-on */}
            <div className="td-toggle-row">
              <div className="td-toggle-info">
                <span className="td-toggle-label">Add-on</span>
                <span className="td-toggle-sub">One-time chip purchase available at the end of the rebuy period.</span>
              </div>
              <button
                className={`td-toggle-btn ${addonAllowed ? 'td-toggle-on' : ''}`}
                onClick={() => setAddonAllowed(v => !v)}
              >
                {addonAllowed ? 'ON' : 'OFF'}
              </button>
            </div>
            {addonAllowed && (
              <div className="td-sub-options td-sub-options-row">
                <label className="td-label">
                  Cost ($)
                  <input className="td-input td-input-sm" type="number" min={1} value={addonCost}
                    onChange={e => setAddonCost(Number(e.target.value))} />
                </label>
                <label className="td-label">
                  Chips received
                  <input className="td-input td-input-sm" type="number" min={1} value={addonChips}
                    onChange={e => setAddonChips(Number(e.target.value))} />
                </label>
                <label className="td-label">
                  Available before level
                  <input className="td-input td-input-sm" type="number" min={1} max={12} value={addonBeforeLevel}
                    onChange={e => setAddonBeforeLevel(Number(e.target.value))} />
                </label>
              </div>
            )}

            {/* Late Registration */}
            <div className="td-toggle-row td-toggle-row-inline">
              <div className="td-toggle-info">
                <span className="td-toggle-label">Late Registration</span>
                <span className="td-toggle-sub">Allow new players to join through level {lateReg}</span>
              </div>
              <div className="td-late-reg-control">
                <input
                  className="td-range td-range-sm"
                  type="range"
                  min={0}
                  max={6}
                  step={1}
                  value={lateReg}
                  onChange={e => setLateReg(Number(e.target.value))}
                />
                <span className="td-late-reg-val">
                  {lateReg === 0 ? 'Disabled' : `Level ${lateReg}`}
                </span>
              </div>
            </div>
          </div>

          {/* ── SECTION 3: Blind Schedule ── */}
          <BlindScheduleBuilder schedule={schedule} onChange={setSchedule} />

          {/* ── ICM Calculator ── */}
          <ICMCalculator />

          {/* ── Create button ── */}
          <div className="td-footer">
            <button className="td-btn-cancel" onClick={onClose}>Cancel</button>
            <button className="td-btn-create" onClick={handleCreate}>
              Create Tournament
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
