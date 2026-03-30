import { useState, useEffect, useRef } from 'react';
import { useEquityWorker } from '../../hooks/useEquityWorker';
import { calculateOuts } from '../../utils/outsCalculator';
import './GTOOverlay.css';

function buildDeck(exclude) {
  const excluded = new Set(exclude.map((c) => `${c.rank}-${c.suit}`));
  const deck = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 2; rank <= 14; rank++) {
      if (!excluded.has(`${rank}-${suit}`)) {
        deck.push({ rank, suit });
      }
    }
  }
  return deck;
}

function equityColor(equity) {
  if (equity > 60) return 'gto-green';
  if (equity > 40) return 'gto-yellow';
  return 'gto-red';
}

function actionBadge(equity, potOdds) {
  if (equity < potOdds) return { label: 'FOLD', cls: 'gto-badge-fold' };
  if (equity < potOdds + 5) return { label: 'CALL', cls: 'gto-badge-call' };
  return { label: 'RAISE', cls: 'gto-badge-raise' };
}

export default function GTOOverlay({
  holeCards,
  communityCards,
  pot,
  callAmount,
  numOpponents,
  phase,
  visible,
}) {
  const { calculateEquity } = useEquityWorker();
  const [expanded, setExpanded] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [equity, setEquity] = useState(null);
  const [outsData, setOutsData] = useState(null);
  const calcRef = useRef(null);

  const potOdds =
    callAmount > 0 ? (callAmount / (pot + callAmount)) * 100 : 0;

  useEffect(() => {
    if (
      !holeCards ||
      holeCards.length < 2 ||
      !communityCards
    ) {
      setEquity(null);
      setOutsData(null);
      return;
    }

    // Cancel any in-flight calculation token
    const token = { cancelled: false };
    calcRef.current = token;

    setCalculating(true);
    setEquity(null);

    // Compute outs synchronously (cheap)
    const outs = calculateOuts(holeCards, communityCards);
    setOutsData(outs);

    // Run equity simulation via the web worker to avoid blocking the UI.
    // Build one scenario per iteration (dealing random opponent hole cards),
    // fire a worker call for each, then average the hero win rates.
    (async () => {
      if (token.cancelled) return;

      const knownCards = [...holeCards, ...communityCards];
      const deckRemaining = buildDeck(knownCards);

      // simulateEquity expects full hole cards for every player.
      // Deal random hands to each opponent per iteration (true Monte Carlo).
      const opponents = Math.max(1, numOpponents || 1);
      const iters = 500;

      // Build all scenarios on the main thread (cheap shuffles only),
      // then dispatch one worker call per scenario and await all results.
      const scenarios = [];
      for (let i = 0; i < iters; i++) {
        const d = [...deckRemaining];
        for (let j = d.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [d[j], d[k]] = [d[k], d[j]];
        }
        const playerHands = [holeCards];
        let ptr = 0;
        for (let op = 0; op < opponents; op++) {
          playerHands.push([d[ptr], d[ptr + 1]]);
          ptr += 2;
        }
        const deckAfterDeal = d.slice(ptr);
        scenarios.push({ playerHands, deckAfterDeal });
      }

      try {
        const promises = scenarios.map(({ playerHands, deckAfterDeal }) =>
          calculateEquity(playerHands, communityCards, deckAfterDeal, 1)
        );
        const results = await Promise.all(promises);

        if (token.cancelled) return;

        let heroWins = 0;
        for (const result of results) {
          heroWins += result.playerEquities[0] / 100;
        }
        const equityPct = Math.round((heroWins / iters) * 100);

        if (!token.cancelled) {
          setEquity(equityPct);
          setCalculating(false);
        }
      } catch (e) {
        if (!token.cancelled) {
          setEquity(0);
          setCalculating(false);
        }
      }
    })();

    return () => {
      token.cancelled = true;
    };
  }, [holeCards, communityCards, numOpponents]);

  if (!visible) return null;

  const potOddsDisplay = potOdds.toFixed(1);
  const equityAdv =
    equity !== null ? (equity - potOdds).toFixed(1) : null;
  const badge = equity !== null ? actionBadge(equity, potOdds) : null;

  return (
    <div className="gto-overlay-root">
      <div className={`gto-panel ${expanded ? 'gto-panel--expanded' : 'gto-panel--collapsed'}`}>
        {/* Header row */}
        <div className="gto-header">
          <span className="gto-training-label">Training Mode</span>
          <button
            className={`gto-toggle-btn ${expanded ? 'gto-toggle-btn--active' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse GTO panel' : 'Expand GTO panel'}
          >
            GTO {expanded ? '▾' : '▸'}
          </button>
        </div>

        {expanded && (
          <div className="gto-body">
            {calculating && (
              <div className="gto-calculating">
                <span className="gto-dot-anim" /> calculating…
              </div>
            )}

            {!calculating && equity !== null && (
              <>
                {/* Win equity */}
                <div className="gto-row gto-equity-row">
                  <span className="gto-label">Win Equity</span>
                  <span className={`gto-equity-number ${equityColor(equity)}`}>
                    {equity}%
                  </span>
                </div>

                {/* Pot odds */}
                <div className="gto-row">
                  <span className="gto-label">Pot Odds</span>
                  <span className="gto-value">{potOddsDisplay}%</span>
                </div>

                {/* Equity advantage */}
                <div className="gto-row">
                  <span className="gto-label">Edge</span>
                  <span
                    className={`gto-value ${
                      parseFloat(equityAdv) >= 0 ? 'gto-green' : 'gto-red'
                    }`}
                  >
                    {parseFloat(equityAdv) >= 0 ? '+' : ''}
                    {equityAdv}%
                  </span>
                </div>

                {/* Suggested action */}
                {badge && (
                  <div className="gto-row gto-action-row">
                    <span className="gto-label">Action</span>
                    <span className={`gto-badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                )}

                {/* Outs section */}
                {outsData && outsData.outs > 0 && (
                  <div className="gto-outs-section">
                    <div className="gto-outs-header">Draw Outs</div>
                    <div className="gto-row">
                      <span className="gto-label">Outs</span>
                      <span className="gto-value gto-cyan">{outsData.outs}</span>
                    </div>
                    {communityCards && communityCards.length < 5 && (
                      <div className="gto-row">
                        <span className="gto-label">
                          {communityCards.length === 3 ? 'Turn %' : 'River %'}
                        </span>
                        <span className="gto-value gto-cyan">
                          {outsData.nextCardPct}%
                        </span>
                      </div>
                    )}
                    {communityCards && communityCards.length === 3 && (
                      <div className="gto-row">
                        <span className="gto-label">By River</span>
                        <span className="gto-value gto-cyan">
                          {outsData.byRiverPct}%
                        </span>
                      </div>
                    )}
                    {outsData.draws.length > 0 && (
                      <div className="gto-draws">
                        {outsData.draws.map((d) => (
                          <span key={d} className="gto-draw-tag">
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Phase label */}
                {phase && (
                  <div className="gto-phase-label">{phase}</div>
                )}
              </>
            )}

            {!calculating && equity === null && (
              <div className="gto-empty">Waiting for cards…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
