import { useTableStore } from '../../store/tableStore';
import './TrainingOverlay.css';

export default function TrainingOverlay() {
  const trainingData = useTableStore((s) => s.trainingData);
  const gameState = useTableStore((s) => s.gameState);

  if (!trainingData) return null;

  const phase = gameState?.phase || 'WaitingForPlayers';

  // Only show during active betting phases
  if (
    phase === 'WaitingForPlayers' ||
    phase === 'HandComplete'
  ) {
    return null;
  }

  const {
    equity,
    potOdds,
    suggestedAction,
    suggestedRaiseAmount,
    reasoning,
    handStrength,
    outs,
    drawType,
  } = trainingData;

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
  if (suggestedAction === 'raise' && suggestedRaiseAmount) {
    actionText = `RAISE ${suggestedRaiseAmount.toLocaleString()}`;
  }

  return (
    <div className="training-overlay">
      <div className="training-header">
        <span className="training-title">Training</span>
        <span className="training-badge">LIVE</span>
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
        <div className="suggested-reasoning">{reasoning}</div>
      </div>

      {/* Hand strength */}
      <div className="training-hand">
        <div className="hand-label">Hand Strength</div>
        <div className="hand-value">{handStrength}</div>
      </div>

      {/* Outs */}
      {outs > 0 && (
        <div className="training-outs">
          <span className="outs-label">Outs</span>
          <span className="outs-value">{outs}</span>
        </div>
      )}

      {/* Draw type */}
      {drawType && (
        <div className="training-draw">{drawType}</div>
      )}
    </div>
  );
}
