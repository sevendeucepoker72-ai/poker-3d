import React, { useState, useEffect, useCallback } from 'react';
import './SessionRecap.css';

// ─── Local recap generator ────────────────────────────────────────────────────

function generateLocalRecap(stats) {
  const {
    handsPlayed = 0,
    netChips = 0,
    winRate = 0,
    biggestPot = 0,
    leakyStreet = 'turn',
  } = stats || {};

  return {
    whatWentWell:
      netChips > 0
        ? `Strong session with a ${winRate}% win rate over ${handsPlayed} hands. Your value betting was on point — the biggest pot of ${biggestPot.toLocaleString()} chips shows you can extract maximum value.`
        : `Tough session, but ${handsPlayed} hands of experience adds up. Your decision-making process showed improvement in later streets.`,
    biggestLeak: `Your biggest leak this session was on the ${
      leakyStreet || 'turn'
    } — consider reviewing those spots. Pot control and position awareness will tighten this up.`,
    handOfSession:
      biggestPot > 0
        ? `The hand of the session was the ${biggestPot.toLocaleString()}-chip pot. Click to replay and analyze your decision-making at each street.`
        : `Keep building your hand history for personalized analysis.`,
  };
}

// ─── Card glyph renderer ──────────────────────────────────────────────────────

const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLORS = { s: '#c8d8f0', h: '#f06060', d: '#f06060', c: '#c8d8f0' };

function CardGlyph({ card }) {
  if (!card || card.length < 2) return <span className="recap-card-glyph recap-card-glyph--back">??</span>;
  const rank = card.slice(0, -1).toUpperCase();
  const suit = card.slice(-1).toLowerCase();
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const color = SUIT_COLORS[suit] || '#fff';
  return (
    <span className="recap-card-glyph" style={{ color }}>
      {rank}
      <span className="recap-card-glyph__suit">{symbol}</span>
    </span>
  );
}

// ─── Score metric card ────────────────────────────────────────────────────────

function ScoreCard({ label, value, colored }) {
  let displayValue = value;
  let colorClass = '';

  if (colored) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      colorClass = num > 0 ? 'recap-score-card__value--positive' : num < 0 ? 'recap-score-card__value--negative' : '';
      displayValue = num > 0 ? `+${typeof value === 'number' ? value.toLocaleString() : value}` : typeof value === 'number' ? value.toLocaleString() : value;
    }
  }

  return (
    <div className="recap-score-card">
      <span className={`recap-score-card__value ${colorClass}`}>{displayValue}</span>
      <span className="recap-score-card__label">{label}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionRecap({
  visible = false,
  sessionStats = {},
  socket = null,
  onClose,
  onOpenAnalytics,
  onViewReplay,
}) {
  const [recap, setRecap] = useState(null);
  const [socketStats, setSocketStats] = useState(null);

  // Merged stats: socket data takes precedence over prop data
  const stats = { ...sessionStats, ...(socketStats || {}) };

  const {
    handsPlayed = 0,
    netChips = 0,
    winRate = 0,
    biggestPot = 0,
    bestHand = '—',
    profitableStreak = 0,
    longestStreak = 0,
    handHistory = [],
  } = stats;

  // Session date/time
  const sessionDate = new Date().toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const sessionTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Biggest-pot hand from history
  const handOfSession = handHistory.length > 0
    ? handHistory.reduce((best, h) => (h.pot > (best?.pot ?? 0) ? h : best), null)
    : null;

  // ── Socket listener ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;
    const handler = ({ paragraphs, stats: remoteStats }) => {
      if (paragraphs) setRecap(paragraphs);
      if (remoteStats) setSocketStats(remoteStats);
    };
    socket.on('sessionRecap', handler);
    return () => socket.off('sessionRecap', handler);
  }, [socket]);

  // ── Generate local recap when visible and no socket recap yet ────────────

  useEffect(() => {
    if (visible && !recap) {
      setRecap(generateLocalRecap(stats));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when hidden
  useEffect(() => {
    if (!visible) {
      setRecap(null);
      setSocketStats(null);
    }
  }, [visible]);

  // ── Key handler ───────────────────────────────────────────────────────────

  const handleKey = useCallback((e) => {
    if (e.key === 'Escape' && onClose) onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, handleKey]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!visible) return null;

  const activeRecap = recap || generateLocalRecap(stats);

  return (
    <div className="recap-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="recap-modal" role="dialog" aria-modal="true" aria-label="Session Recap">

        {/* Header */}
        <div className="recap-header">
          <div className="recap-header__title">
            <span className="recap-header__icon">📋</span>
            <h2 className="recap-header__text">Session Recap</h2>
          </div>
          <div className="recap-header__datetime">
            <span className="recap-header__date">{sessionDate}</span>
            <span className="recap-header__time">{sessionTime}</span>
          </div>
          <button className="recap-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Score card row */}
        <div className="recap-scorecards">
          <ScoreCard label="Hands Played" value={handsPlayed} />
          <ScoreCard label="Net Chips" value={netChips} colored />
          <ScoreCard label="Win Rate" value={`${winRate}%`} />
          <ScoreCard label="Best Hand" value={bestHand} />
        </div>

        {/* AI Recap paragraphs */}
        <div className="recap-prose">
          <div className="recap-prose__item">
            <span className="recap-prose__num">01</span>
            <p className="recap-prose__text">{activeRecap.whatWentWell}</p>
          </div>
          <div className="recap-prose__item">
            <span className="recap-prose__num">02</span>
            <p className="recap-prose__text">{activeRecap.biggestLeak}</p>
          </div>
          <div className="recap-prose__item">
            <span className="recap-prose__num">03</span>
            <p className="recap-prose__text">{activeRecap.handOfSession}</p>
          </div>
        </div>

        {/* Hand of Session */}
        {handOfSession && (
          <div className="recap-hot-hand" onClick={onViewReplay} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onViewReplay?.()}
            aria-label="Replay hand of session">
            <div className="recap-hot-hand__label">Hand of the Session</div>
            <div className="recap-hot-hand__cards">
              {(handOfSession.cards || []).map((c, i) => (
                <CardGlyph key={i} card={c} />
              ))}
            </div>
            <div className="recap-hot-hand__meta">
              <span className="recap-hot-hand__pot">
                Pot: {handOfSession.pot?.toLocaleString() ?? biggestPot.toLocaleString()} chips
              </span>
              {handOfSession.result && (
                <span className={`recap-hot-hand__result recap-hot-hand__result--${handOfSession.result === 'win' ? 'win' : 'loss'}`}>
                  {handOfSession.result === 'win' ? 'Won' : 'Lost'}
                </span>
              )}
            </div>
            <span className="recap-hot-hand__cta">▶ Replay</span>
          </div>
        )}

        {/* Streak indicators */}
        <div className="recap-streaks">
          <div className="recap-streak">
            <span className="recap-streak__value">{profitableStreak}</span>
            <span className="recap-streak__label">Sessions Profitable in a Row</span>
          </div>
          <div className="recap-streak">
            <span className="recap-streak__value">{longestStreak}</span>
            <span className="recap-streak__label">Longest Profitable Streak</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="recap-actions">
          <button className="recap-btn recap-btn--primary" onClick={onOpenAnalytics}>
            View Full Analytics
          </button>
          <button className="recap-btn recap-btn--secondary" onClick={onViewReplay}>
            Replay Hand
          </button>
          <button className="recap-btn recap-btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
