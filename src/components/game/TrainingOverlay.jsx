import { useEffect } from 'react';
import { useTableStore } from '../../store/tableStore';
import './TrainingOverlay.css';

// R2 (TABLEUI-10, 2026-10-11) — the training panel is DOCKED and collapsible.
// On a phone it used to sit over the top-left of the table: it covered Back,
// Sit Out, Options and the Training badge, and the board, with no way to close
// it. Now the top bar's Training badge is its dock ("🎓 62%": it opens and
// minimizes the panel — tableStore.trainingPanelOpen, minimized by default on a
// phone); open on a phone, it sits under the top bar and above the board
// (portrait) or in a column on the right between the bars (landscape), with
// its own minimize and close (= turn training off) controls. Desktop keeps the
// side panel, with the same two controls.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default function TrainingOverlay() {
  const trainingData = useTableStore((s) => s.trainingData);
  const gameState = useTableStore((s) => s.gameState);
  const toggleTraining = useTableStore((s) => s.toggleTraining);
  const open = useTableStore((s) => s.trainingPanelOpen);
  const setOpen = useTableStore((s) => s.setTrainingPanelOpen);

  // Escape minimizes the open panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!trainingData || typeof trainingData !== 'object') return null;

  const phase = gameState?.phase || 'WaitingForPlayers';

  // Only show during active betting phases
  if (
    phase === 'WaitingForPlayers' ||
    phase === 'HandComplete'
  ) {
    return null;
  }

  const {
    potOdds: rawPotOdds,
    suggestedAction: rawAction,
    suggestedRaiseAmount,
    reasoning,
    handStrength,
    outs,
    drawType,
  } = trainingData;
  const equity = Math.max(0, Math.min(100, num(trainingData.equity) ?? 0));
  const potOdds = num(rawPotOdds) ?? 0;
  const suggestedAction = typeof rawAction === 'string' && rawAction ? rawAction : 'check';

  // Equity color class
  const equityClass =
    equity < 30 ? 'equity-low' : equity < 60 ? 'equity-mid' : 'equity-high';

  // SVG circle gauge
  const circumference = 2 * Math.PI * 15.9155;
  const dashArray = `${(equity / 100) * circumference}, ${circumference}`;

  // Suggested action class
  const actionClass = `action-${suggestedAction}`;

  // Format suggested action text
  let actionText = suggestedAction.toUpperCase();
  if (suggestedAction === 'raise' && num(suggestedRaiseAmount)) {
    actionText = `RAISE ${suggestedRaiseAmount.toLocaleString()}`;
  }

  if (!open) return null;

  return (
    <div className="training-overlay training-overlay--open" role="region" aria-label="Training panel">
      <div className="training-header">
        <span className="training-title">Training</span>
        <span className="training-badge">LIVE</span>
        <span className="training-header-actions">
          <button
            type="button"
            className="training-hdr-btn training-minimize"
            onClick={() => setOpen(false)}
            aria-label="Minimize the training panel"
            title="Minimize"
          >▾</button>
          <button
            type="button"
            className="training-hdr-btn training-close"
            onClick={() => { setOpen(false); if (toggleTraining) toggleTraining(); }}
            aria-label="Close training (turn training mode off)"
            title="Turn training off"
          >✕</button>
        </span>
      </div>

      {/* Equity gauge */}
      <div className="training-equity">
        <div className="equity-gauge">
          <svg viewBox="0 0 36 36" className="equity-svg">
            <path
              className="equity-bg"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className={`equity-fill ${equityClass}`}
              strokeDasharray={dashArray}
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <div className="equity-text">
            <span className={`equity-pct ${equityClass}`}>
              {Math.round(equity)}%
            </span>
            <span className="equity-label">Equity</span>
          </div>
        </div>
        <div className="equity-info">
          <div className="equity-info-label">Win Probability</div>
          <div className="equity-info-value">{equity.toFixed(1)}%</div>
        </div>
      </div>

      {/* Pot odds */}
      {potOdds > 0 && (
        <div className="training-pot-odds">
          <span className="pot-odds-label">Pot Odds</span>
          <span className="pot-odds-value">{potOdds.toFixed(1)}%</span>
        </div>
      )}

      {/* Suggested action */}
      <div className={`training-suggested ${actionClass}`}>
        <div className="suggested-label">Suggested</div>
        <div className={`suggested-action ${actionClass}`}>{actionText}</div>
        {typeof reasoning === 'string' && reasoning && <div className="suggested-reasoning">{reasoning}</div>}
      </div>

      {/* Hand strength */}
      {typeof handStrength === 'string' && handStrength && (
        <div className="training-hand">
          <div className="hand-label">Hand Strength</div>
          <div className="hand-value">{handStrength}</div>
        </div>
      )}

      {/* Outs */}
      {num(outs) > 0 && (
        <div className="training-outs">
          <span className="outs-label">Outs</span>
          <span className="outs-value">{outs}</span>
        </div>
      )}

      {/* Draw type */}
      {typeof drawType === 'string' && drawType && (
        <div className="training-draw">{drawType}</div>
      )}
    </div>
  );
}
