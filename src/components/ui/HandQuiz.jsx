import { useState, useCallback } from 'react';
import { evaluateHandStrength } from '../../utils/handStrength';
import './HandQuiz.css';

const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'];
const SUIT_COLORS = ['#333', '#DC2626', '#3B82F6', '#16A34A'];
const RANK_DISPLAY = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const ACTIONS = [
  { id: 'fold', label: 'Fold' },
  { id: 'checkCall', label: 'Check / Call' },
  { id: 'raiseSmall', label: 'Raise Small' },
  { id: 'raiseBig', label: 'Raise Big' },
];

const TOTAL_QUESTIONS = 10;

function randomCard(usedSet) {
  let card;
  let key;
  do {
    const rank = Math.floor(Math.random() * 13) + 2; // 2-14
    const suit = Math.floor(Math.random() * 4);
    card = { rank, suit };
    key = `${rank}-${suit}`;
  } while (usedSet.has(key));
  usedSet.add(key);
  return card;
}

function generateScenario() {
  const used = new Set();
  const holeCards = [randomCard(used), randomCard(used)];

  // Random community: 3-5 cards
  const communityCount = 3 + Math.floor(Math.random() * 3);
  const communityCards = [];
  for (let i = 0; i < communityCount; i++) {
    communityCards.push(randomCard(used));
  }

  // Pot size: random between 100 and 5000
  const pot = Math.round((200 + Math.random() * 4800) / 50) * 50;

  // Bet to call: 0 (check) or some fraction of pot
  const hasBet = Math.random() > 0.3;
  const betToCall = hasBet ? Math.round((pot * (0.2 + Math.random() * 0.8)) / 50) * 50 : 0;

  return { holeCards, communityCards, pot, betToCall };
}

function getCorrectAction(strength, potOdds, betToCall) {
  if (betToCall === 0) {
    // No bet to face
    if (strength >= 0.7) return 'raiseBig';
    if (strength >= 0.45) return 'raiseSmall';
    return 'checkCall'; // check
  }
  // Facing a bet
  const equityNeeded = potOdds > 0 ? 1 / (1 + potOdds) : 1;
  if (strength >= equityNeeded + 0.25) return 'raiseBig';
  if (strength >= equityNeeded + 0.1) return 'raiseSmall';
  if (strength >= equityNeeded - 0.05) return 'checkCall';
  return 'fold';
}

function renderCard(card) {
  return (
    <div
      className="hq-card"
      key={`${card.rank}-${card.suit}`}
      style={{ color: SUIT_COLORS[card.suit] }}
    >
      {RANK_DISPLAY[card.rank]}{SUIT_SYMBOLS[card.suit]}
    </div>
  );
}

export default function HandQuiz({ onClose }) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [scenario, setScenario] = useState(() => generateScenario());
  const [selectedAction, setSelectedAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);

  const strength = evaluateHandStrength(scenario.holeCards, scenario.communityCards);
  const potOdds = scenario.betToCall > 0 ? scenario.pot / scenario.betToCall : 0;
  const correctAction = getCorrectAction(strength.strength, potOdds, scenario.betToCall);

  const handleAction = useCallback((actionId) => {
    if (selectedAction !== null) return; // Already answered

    setSelectedAction(actionId);
    const isCorrect = actionId === correctAction;

    if (isCorrect) {
      setScore(prev => prev + 10);
      setStreak(prev => {
        const next = prev + 1;
        setBestStreak(b => Math.max(b, next));
        return next;
      });
      setCorrectCount(prev => prev + 1);
      setFeedback({ correct: true, message: `Correct! ${strength.name} (${Math.round(strength.strength * 100)}% equity)` });
    } else {
      setStreak(0);
      setWrongCount(prev => prev + 1);
      const correctLabel = ACTIONS.find(a => a.id === correctAction)?.label || correctAction;
      setFeedback({ correct: false, message: `Better: ${correctLabel}. ${strength.name} (${Math.round(strength.strength * 100)}% equity)` });
    }
  }, [selectedAction, correctAction, strength]);

  const handleNext = useCallback(() => {
    const nextIndex = questionIndex + 1;
    if (nextIndex >= TOTAL_QUESTIONS) {
      setShowResults(true);
      return;
    }
    setQuestionIndex(nextIndex);
    setScenario(generateScenario());
    setSelectedAction(null);
    setFeedback(null);
  }, [questionIndex]);

  const handleRestart = useCallback(() => {
    setQuestionIndex(0);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setCorrectCount(0);
    setWrongCount(0);
    setScenario(generateScenario());
    setSelectedAction(null);
    setFeedback(null);
    setShowResults(false);
  }, []);

  if (showResults) {
    const pct = Math.round((correctCount / TOTAL_QUESTIONS) * 100);
    const gradeClass = pct >= 70 ? 'hq-score-good' : pct >= 40 ? 'hq-score-ok' : 'hq-score-bad';

    return (
      <div className="hand-quiz-overlay" onClick={onClose}>
        <div className="hand-quiz-panel" onClick={e => e.stopPropagation()}>
          <div className="hq-header">
            <span className="hq-title">Quiz Complete</span>
            <button className="hq-close" onClick={onClose}>Close</button>
          </div>

          <div className="hq-results">
            <div className={`hq-results-score ${gradeClass}`}>{pct}%</div>
            <div className="hq-results-label">{correctCount} of {TOTAL_QUESTIONS} correct</div>

            <div className="hq-results-breakdown">
              <div className="hq-results-stat">
                <div className="hq-results-stat-value" style={{ color: '#4ADE80' }}>{correctCount}</div>
                <div className="hq-results-stat-label">Correct</div>
              </div>
              <div className="hq-results-stat">
                <div className="hq-results-stat-value" style={{ color: '#EF4444' }}>{wrongCount}</div>
                <div className="hq-results-stat-label">Wrong</div>
              </div>
              <div className="hq-results-stat">
                <div className="hq-results-stat-value" style={{ color: '#F59E0B' }}>{bestStreak}</div>
                <div className="hq-results-stat-label">Best Streak</div>
              </div>
              <div className="hq-results-stat">
                <div className="hq-results-stat-value" style={{ color: '#B388FF' }}>{score}</div>
                <div className="hq-results-stat-label">Score</div>
              </div>
            </div>

            <button className="hq-next-btn" onClick={handleRestart}>Play Again</button>
            <button
              className="hq-close"
              style={{ display: 'block', width: '100%', marginTop: '10px', padding: '8px' }}
              onClick={onClose}
            >
              Back to Profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  const streetLabel = scenario.communityCards.length === 3 ? 'Flop' :
    scenario.communityCards.length === 4 ? 'Turn' : 'River';

  return (
    <div className="hand-quiz-overlay" onClick={onClose}>
      <div className="hand-quiz-panel" onClick={e => e.stopPropagation()}>
        <div className="hq-header">
          <span className="hq-title">Hand Quiz</span>
          <button className="hq-close" onClick={onClose}>Close</button>
        </div>

        <div className="hq-progress">
          <div className="hq-progress-bar">
            <div className="hq-progress-fill" style={{ width: `${((questionIndex + 1) / TOTAL_QUESTIONS) * 100}%` }} />
          </div>
          <span className="hq-progress-text">{questionIndex + 1}/{TOTAL_QUESTIONS}</span>
        </div>

        <div className="hq-score">
          Score: {score}
          {streak > 1 && <span className="hq-streak">Streak: {streak}</span>}
        </div>

        <div className="hq-scenario">
          <div className="hq-scenario-label">Your Hole Cards</div>
          <div className="hq-cards-row">
            {scenario.holeCards.map(renderCard)}
          </div>

          <div className="hq-scenario-label">Community ({streetLabel})</div>
          <div className="hq-cards-row">
            {scenario.communityCards.map(renderCard)}
          </div>

          <div className="hq-info-row">
            <div className="hq-info-item">
              Pot: <span className="hq-info-value">{scenario.pot.toLocaleString()}</span>
            </div>
            {scenario.betToCall > 0 && (
              <div className="hq-info-item">
                To Call: <span className="hq-info-value">{scenario.betToCall.toLocaleString()}</span>
              </div>
            )}
            {scenario.betToCall > 0 && (
              <div className="hq-info-item">
                Odds: <span className="hq-info-value">{potOdds.toFixed(1)}:1</span>
              </div>
            )}
          </div>
        </div>

        <div className="hq-actions">
          {ACTIONS.map((action) => {
            let btnClass = 'hq-action-btn';
            if (selectedAction !== null) {
              if (action.id === correctAction) btnClass += ' hq-correct';
              else if (action.id === selectedAction && selectedAction !== correctAction) btnClass += ' hq-wrong';
            } else if (action.id === selectedAction) {
              btnClass += ' hq-selected';
            }
            return (
              <button
                key={action.id}
                className={btnClass}
                onClick={() => handleAction(action.id)}
                disabled={selectedAction !== null}
              >
                {action.label}
              </button>
            );
          })}
        </div>

        {feedback && (
          <div className={`hq-feedback ${feedback.correct ? 'hq-fb-correct' : 'hq-fb-wrong'}`}>
            {feedback.message}
          </div>
        )}

        {selectedAction !== null && (
          <button className="hq-next-btn" onClick={handleNext}>
            {questionIndex + 1 >= TOTAL_QUESTIONS ? 'See Results' : 'Next Question'}
          </button>
        )}
      </div>
    </div>
  );
}
