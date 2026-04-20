// Mobile redesign U1 + U2 + U11: consolidates the side-overlay clutter
// (session stats, last hand, reactions, pre-action queues, equity badges)
// into one ⋯ floating button + bottom sheet. On phone, only this button
// is visible at the edges of the table; tapping opens a swipe-to-dismiss
// sheet that covers the lower 60% of the viewport.
//
// Usage: render <MobileMoreSheet /> once inside GameHUD. The component
// self-decides whether to show anything based on viewport (matchMedia);
// it's a no-op on tablet+.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * @param {object} props
 * @param {string} props.preAction - one of 'checkFold' | 'callAny' | 'checkOnly' | null
 * @param {(v: string|null) => void} props.setPreAction
 * @param {Array}  props.lastHand - last-hand history entry (nullable)
 * @param {object} props.sessionStats - hands/winRate/biggestPot summary
 * @param {object} props.handStrength - current hand evaluation (for "Tools" tab)
 * @param {boolean} props.isMyTurn - used to prioritize the "Queue" tab
 * @param {() => void} props.onOpenReactions - hook that opens the emote wheel
 * @param {() => void} props.onOpenChat - hook that opens chat sheet
 * @param {() => void} props.onOpenSettings - hook that opens settings
 */
export default function MobileMoreSheet({
  preAction,
  setPreAction,
  lastHand,
  sessionStats,
  handStrength,
  isMyTurn,
  onOpenReactions,
  onOpenChat,
  onOpenSettings,
}) {
  // Only render on phone-portrait. matchMedia stays reactive in case of
  // orientation change or tablet in split-screen mode.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 480px) and (orientation: portrait)');
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  const [open, setOpen] = useState(false);
  // Active tab inside the sheet. Auto-shifts to "Queue" on your turn, to
  // "Last Hand" in the gap between hands, and "Stats" otherwise.
  const [tab, setTab] = useState('queue');
  useEffect(() => {
    if (!open) return;
    if (isMyTurn) setTab('queue');
    else if (lastHand) setTab('hand');
    else setTab('stats');
  }, [open, isMyTurn, lastHand]);

  // Swipe-to-dismiss: drag the sheet handle down past 60px to close.
  // Keeps position:fixed layout; uses translate so it doesn't reflow
  // the table underneath during the drag.
  const sheetRef = useRef(null);
  const dragState = useRef({ startY: 0, currentY: 0, dragging: false });
  const onTouchStart = useCallback((e) => {
    dragState.current.startY = e.touches[0].clientY;
    dragState.current.currentY = 0;
    dragState.current.dragging = true;
  }, []);
  const onTouchMove = useCallback((e) => {
    if (!dragState.current.dragging) return;
    const dy = e.touches[0].clientY - dragState.current.startY;
    if (dy > 0 && sheetRef.current) {
      dragState.current.currentY = dy;
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);
  const onTouchEnd = useCallback(() => {
    if (!dragState.current.dragging) return;
    dragState.current.dragging = false;
    if (sheetRef.current) sheetRef.current.style.transform = '';
    if (dragState.current.currentY > 60) setOpen(false);
  }, []);

  // Close on Escape for accessibility (external keyboard case).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!isPhone) return null;

  const hasPreActionQueued = preAction != null;

  return createPortal(
    <>
      {/* Floating ⋯ button. Always rendered; takes you to the sheet. */}
      <button
        className={`more-fab ${hasPreActionQueued ? 'more-fab--queued' : ''} ${open ? 'more-fab--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close more options' : 'Open more options (stats, reactions, last hand, queue action)'}
        aria-expanded={open}
      >
        <span className="more-fab-dots">⋯</span>
        {hasPreActionQueued && <span className="more-fab-badge" aria-hidden="true" />}
      </button>

      {open && (
        <>
          <div
            className="more-sheet-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            className="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More options"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div className="more-sheet-grip" aria-hidden="true" />
            <div className="more-sheet-tabs" role="tablist">
              <button
                role="tab"
                className={`more-sheet-tab ${tab === 'queue' ? 'more-sheet-tab--active' : ''}`}
                aria-selected={tab === 'queue'}
                onClick={() => setTab('queue')}
              >⚡ Queue</button>
              <button
                role="tab"
                className={`more-sheet-tab ${tab === 'hand' ? 'more-sheet-tab--active' : ''}`}
                aria-selected={tab === 'hand'}
                onClick={() => setTab('hand')}
              >🃏 Last Hand</button>
              <button
                role="tab"
                className={`more-sheet-tab ${tab === 'stats' ? 'more-sheet-tab--active' : ''}`}
                aria-selected={tab === 'stats'}
                onClick={() => setTab('stats')}
              >📊 Stats</button>
              <button
                role="tab"
                className={`more-sheet-tab ${tab === 'tools' ? 'more-sheet-tab--active' : ''}`}
                aria-selected={tab === 'tools'}
                onClick={() => setTab('tools')}
              >🛠️ Tools</button>
            </div>

            <div className="more-sheet-body" role="tabpanel">
              {tab === 'queue' && (
                <div className="more-sheet-queue">
                  {/* U11: pre-action queue promoted to its own roomy sheet
                      section. Each button is tall (56px) so the thumb
                      can't miss. Tapping the already-active one clears
                      the queue. */}
                  <p className="more-sheet-hint">
                    Queue your next action — it fires instantly when the
                    action gets to you.
                  </p>
                  <button
                    className={`mq-btn ${preAction === 'checkFold' ? 'mq-btn--active' : ''}`}
                    onClick={() => setPreAction(preAction === 'checkFold' ? null : 'checkFold')}
                  >
                    <span className="mq-icon">🔄</span>
                    <span className="mq-text">
                      <strong>Check / Fold</strong>
                      <small>Checks for free, folds to any bet</small>
                    </span>
                  </button>
                  <button
                    className={`mq-btn ${preAction === 'callAny' ? 'mq-btn--active' : ''}`}
                    onClick={() => setPreAction(preAction === 'callAny' ? null : 'callAny')}
                  >
                    <span className="mq-icon">✋</span>
                    <span className="mq-text">
                      <strong>Call Any</strong>
                      <small>Calls whatever bet comes to you</small>
                    </span>
                  </button>
                  <button
                    className={`mq-btn ${preAction === 'checkOnly' ? 'mq-btn--active' : ''}`}
                    onClick={() => setPreAction(preAction === 'checkOnly' ? null : 'checkOnly')}
                  >
                    <span className="mq-icon">✓</span>
                    <span className="mq-text">
                      <strong>Check (only)</strong>
                      <small>Checks if free, otherwise lets you decide</small>
                    </span>
                  </button>
                  {preAction && (
                    <button
                      className="mq-clear"
                      onClick={() => setPreAction(null)}
                    >Clear queued action</button>
                  )}
                </div>
              )}

              {tab === 'hand' && (
                <div className="more-sheet-hand">
                  {lastHand ? (
                    <>
                      <h4>Last hand</h4>
                      <p className="lh-result">
                        {lastHand.won ? '🏆 Won ' : '❌ Lost '}
                        <strong>{(lastHand.delta || 0).toLocaleString()}</strong> chips
                      </p>
                      {lastHand.handName && (
                        <p className="lh-hand">Your hand: <strong>{lastHand.handName}</strong></p>
                      )}
                      {lastHand.board && lastHand.board.length > 0 && (
                        <p className="lh-board">Board: {lastHand.board.join(' · ')}</p>
                      )}
                    </>
                  ) : (
                    <p className="more-sheet-empty">No hands played yet this session.</p>
                  )}
                </div>
              )}

              {tab === 'stats' && (
                <div className="more-sheet-stats">
                  {sessionStats ? (
                    <div className="stat-grid">
                      <div className="stat-cell">
                        <span className="stat-label">Hands</span>
                        <span className="stat-val">{sessionStats.hands || 0}</span>
                      </div>
                      <div className="stat-cell">
                        <span className="stat-label">Win rate</span>
                        <span className="stat-val">
                          {sessionStats.hands > 0
                            ? `${Math.round(100 * (sessionStats.won || 0) / sessionStats.hands)}%`
                            : '—'}
                        </span>
                      </div>
                      <div className="stat-cell">
                        <span className="stat-label">Biggest pot</span>
                        <span className="stat-val">{(sessionStats.biggestPot || 0).toLocaleString()}</span>
                      </div>
                      <div className="stat-cell">
                        <span className="stat-label">Session P/L</span>
                        <span className={`stat-val ${(sessionStats.pl || 0) >= 0 ? 'stat-val--up' : 'stat-val--down'}`}>
                          {(sessionStats.pl || 0) >= 0 ? '+' : ''}{(sessionStats.pl || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="more-sheet-empty">No stats yet.</p>
                  )}
                  {handStrength && (
                    <div className="stat-current-hand">
                      <span>Current hand strength:</span>
                      <strong>{Math.round(handStrength.strength * 100)}%</strong>
                      <small>{handStrength.name}</small>
                    </div>
                  )}
                </div>
              )}

              {tab === 'tools' && (
                <div className="more-sheet-tools">
                  <button className="tool-row" onClick={() => { setOpen(false); onOpenReactions?.(); }}>
                    <span className="tool-icon">🎉</span>
                    <span className="tool-label">Reactions & Emotes</span>
                  </button>
                  <button className="tool-row" onClick={() => { setOpen(false); onOpenChat?.(); }}>
                    <span className="tool-icon">💬</span>
                    <span className="tool-label">Chat</span>
                  </button>
                  <button className="tool-row" onClick={() => { setOpen(false); onOpenSettings?.(); }}>
                    <span className="tool-icon">⚙️</span>
                    <span className="tool-label">Settings</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>,
    document.body
  );
}
