import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../../services/socketService';
import './PostHandCoach.css';

const AUTO_DISMISS_SECS = 12;

function scoreColor(score) {
  if (score >= 7) return 'phc-green';
  if (score >= 5) return 'phc-yellow';
  return 'phc-red';
}

function qualityClass(quality) {
  switch ((quality || '').toLowerCase()) {
    case 'good': return 'phc-quality-good';
    case 'ok':   return 'phc-quality-ok';
    default:     return 'phc-quality-poor';
  }
}

function qualityLabel(quality) {
  switch ((quality || '').toLowerCase()) {
    case 'good': return 'Good';
    case 'ok':   return 'Ok';
    default:     return 'Poor';
  }
}

export default function PostHandCoach({ handHistory, playerName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECS);
  const [dismissed, setDismissed] = useState(false);

  const countdownRef = useRef(null);
  const listenerCleanupRef = useRef(null);

  // Request coaching and listen for result
  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      setError('Not connected to server.');
      setLoading(false);
      return;
    }

    socket.emit('coachHand', { handHistory, playerName });

    function handleResult(data) {
      if (data && data.success && data.analysis) {
        setAnalysis(data.analysis);
      } else {
        setError(data?.error || 'Analysis unavailable.');
      }
      setLoading(false);
    }

    socket.on('coachResult', handleResult);

    listenerCleanupRef.current = () => {
      socket.off('coachResult', handleResult);
    };

    return () => {
      if (listenerCleanupRef.current) listenerCleanupRef.current();
    };
  }, [handHistory, playerName]);

  // Start countdown once analysis arrives
  useEffect(() => {
    if (loading || dismissed) return;

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          handleDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownRef.current);
  }, [loading, dismissed]);

  function handleDismiss() {
    setDismissed(true);
    clearInterval(countdownRef.current);
    if (onClose) onClose();
  }

  if (dismissed) return null;

  return (
    <div className="phc-backdrop" role="dialog" aria-modal="true" aria-label="Post-hand coaching">
      <div className="phc-panel">
        {/* Header */}
        <div className="phc-header">
          <div className="phc-header-left">
            <span className="phc-robot-icon" aria-hidden="true">🤖</span>
            <span className="phc-title">AI Hand Coach</span>
          </div>
          <button className="phc-close-btn" onClick={handleDismiss} aria-label="Close coaching panel">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="phc-body">
          {loading && (
            <div className="phc-loading">
              <div className="phc-spinner" aria-hidden="true" />
              <p className="phc-loading-text">AI coach is analyzing your hand…</p>
            </div>
          )}

          {!loading && error && (
            <div className="phc-error">
              <span className="phc-error-icon" aria-hidden="true">⚠</span>
              {error}
            </div>
          )}

          {!loading && analysis && (
            <>
              {/* Score */}
              <div className="phc-score-row">
                <div className={`phc-score-number ${scoreColor(analysis.score)}`}>
                  {analysis.score}
                  <span className="phc-score-denom">/10</span>
                </div>
                <div className="phc-score-label">Hand Score</div>
              </div>

              {/* Summary */}
              {analysis.summary && (
                <p className="phc-summary">{analysis.summary}</p>
              )}

              {/* Decisions */}
              {analysis.decisions && analysis.decisions.length > 0 && (
                <div className="phc-decisions-section">
                  <div className="phc-section-title">Decision Breakdown</div>
                  <ul className="phc-decisions-list">
                    {analysis.decisions.map((dec, idx) => (
                      <li key={idx} className="phc-decision-item">
                        <div className="phc-decision-top">
                          <span className="phc-decision-action">{dec.action}</span>
                          <span className={`phc-quality-badge ${qualityClass(dec.quality)}`}>
                            {qualityLabel(dec.quality)}
                          </span>
                        </div>
                        {dec.advice && (
                          <p className="phc-decision-advice">{dec.advice}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key lesson */}
              {analysis.keyLesson && (
                <div className="phc-key-lesson">
                  <div className="phc-key-lesson-label">
                    <span aria-hidden="true">💡</span> Key Lesson
                  </div>
                  <p className="phc-key-lesson-text">{analysis.keyLesson}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with countdown */}
        {!loading && (
          <div className="phc-footer">
            <span className="phc-countdown-text">
              Auto-close in {countdown}s
            </span>
            <button className="phc-dismiss-btn" onClick={handleDismiss}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
