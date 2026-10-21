import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTableStore } from '../../store/tableStore';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import {
  subscribeMultiTables, joinMultiTable, leaveMultiTable, sendMultiTableAction, sendMultiTableDraw,
  disconnectAllMultiTables, MAX_SECONDARY_TABLES,
} from '../../services/multiTableManager';
import { noRedHue } from '../../utils/noRedHue';
import { isAllInOrFoldTable, drawTurnInfo, drawSelectionKey } from '../../utils/actionBar';
import './MultiTableView.css';

// 2026-06-18 — Phase 3f: REAL multi-tabling. Slot 0 is the app's primary table
// (tableStore + primary socket); slots 1..N are real secondary tables managed
// by multiTableManager (one socket each, actually seated and playable). No more
// mock/random data.

// ─── Card display helpers ─────────────────────────────────────────────────────
function parseCard(cardStr) {
  if (!cardStr) return null;
  const str = String(cardStr);
  const suit = str.slice(-1);
  const rank = str.slice(0, -1);
  return { rank, suit };
}
function isRedSuit(suit) { return suit === '♥' || suit === '♦'; }

function CardSlot({ card, large = false, onPick, picked = false }) {
  if (!card) {
    return <span className={`mtv-card mtv-card-empty${large ? ' mtv-card-large' : ''}`}>🂠</span>;
  }
  const { rank, suit } = typeof card === 'string' ? (parseCard(card) || { rank: '?', suit: '?' }) : card;
  const red = isRedSuit(suit);
  // Gameplay audit G176 — in a draw round his cards are tapped to discard.
  const pick = onPick
    ? {
        onClick: onPick, role: 'button', tabIndex: 0, 'aria-pressed': picked,
        title: picked ? 'Keep this card' : 'Discard this card',
      }
    : {};
  return (
    <span
      className={`mtv-card${large ? ' mtv-card-large' : ''} ${red ? 'suit-red' : 'suit-black'}${onPick ? ' mtv-card-pickable' : ''}${picked ? ' mtv-card-discard' : ''}`}
      {...pick}
    >
      {rank}{suit}
    </span>
  );
}

function PlayerStrip({ players = [], currentTurn }) {
  return (
    <div className="mtv-player-strip">
      {players.map((p, i) => {
        const isActing = p.seatIndex === currentTurn || p.isActing;
        return (
          <div key={i} className={`mtv-avatar-wrap${isActing ? ' mtv-avatar-acting' : ''}`}>
            <div
              className={`mtv-avatar-circle${isActing ? ' mtv-avatar-glow' : ''}${p.isFolded ? ' mtv-avatar-folded' : ''}`}
              // R3 (APPUI-P3-7) — no red: seats whose hue was red / rose (0, 7) move to blue.
              style={{ background: `hsl(${noRedHue((p.seatIndex * 47 + 17) % 360)}, 55%, 42%)` }}
            >
              {(p.name || 'P')[0].toUpperCase()}
            </div>
            <span className="mtv-avatar-chips">
              {p.chips >= 1000 ? `${(p.chips / 1000).toFixed(1)}k` : p.chips}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// #10 (2026-07-01 audit): the MultiTableView Raise button emitted a raise with
// NO amount, which the server rejects ("Invalid raise amount") — so raising was
// impossible from the entire multi-table UI. Compute a valid "raise TO" total
// (a min-raise, capped at the hero's all-in) from the table's game state so the
// Raise button actually works. Multi-tablers use the primary GameHUD's full
// slider for sized raises; here a one-tap min-raise is the sensible default.
function computeMinRaiseTo(gs) {
  if (!gs) return 0;
  const mySeatIdx = gs.mySeatIndex ?? gs.yourSeat ?? -1;
  const hero = (gs.seats || []).find((s) => s.seatIndex === mySeatIdx);
  const myChips = hero?.chipCount ?? hero?.chips ?? 0;
  const myBet = hero?.currentBet ?? 0;
  const maxTo = myChips + myBet; // true all-in "raise to" (see GameHUD #11)
  const minTo = gs.minRaise ?? ((gs.currentBetToMatch ?? 0) + (gs.bigBlind || 20));
  return Math.max(1, Math.min(minTo, maxTo));
}

// ─── Mini table panel ─────────────────────────────────────────────────────────
function MiniTablePanel({ tableData, isActive, onAction, onLeave }) {
  // Gameplay audit G176 (2026-10-21) — the cards picked to discard belong to
  // one draw round of one hand at this tile's table (cleared when it changes).
  const drawKey = tableData?.drawKey ?? '';
  const [picked, setPicked] = useState({ key: '', list: [], sent: false });
  const discards = picked.key === drawKey ? picked.list : [];
  const drawSent = picked.key === drawKey && picked.sent === true; // one draw per round (a 2nd is refused)
  if (!tableData) {
    return (
      <div className="mtv-panel mtv-panel-empty">
        <div className="mtv-panel-empty-label">No table joined</div>
        {onAction?.addTable && (
          <button className="mtv-btn-add-inside" onClick={onAction.addTable}>＋ Add Table</button>
        )}
      </div>
    );
  }

  const {
    tableName, pot, currentTurn, mySeatIndex, isMyTurn, callAmount = 0, status, canRaise = true,
    players = [], communityCards = [], heroCards = [], isPrimary, holeCardCount = 2,
    isDrawRound = false, canDraw = false, inHand = false,
  } = tableData;
  const toggleDiscard = (i) => setPicked((p) => {
    const d = p.key === drawKey ? p.list : [];
    return { key: drawKey, list: d.includes(i) ? d.filter((x) => x !== i) : [...d, i], sent: false };
  });
  const canDrawHere = canDraw && !drawSent;
  const holeSlots = Math.max(2, Math.min(7, Math.max(Number(holeCardCount) || 2, heroCards?.length || 0)));

  if (status && status !== 'playing') {
    return (
      <div className="mtv-panel">
        <div className="mtv-panel-header">
          <span className="mtv-panel-name">{tableName || 'Joining…'}</span>
          {!isPrimary && onLeave && <button className="mtv-leave-btn" onClick={onLeave} title="Leave">×</button>}
        </div>
        <div className="mtv-panel-status">
          {status === 'error' ? (tableData.error || 'Could not join') : 'Connecting…'}
        </div>
      </div>
    );
  }

  return (
    <div className={`mtv-panel${isActive ? ' mtv-panel-active' : ''}${isMyTurn || canDraw ? ' mtv-panel-myturn' : ''}`}>
      <div className="mtv-panel-header">
        <span className="mtv-panel-name">{tableName}</span>
        <span className="mtv-panel-pot">Pot: {pot?.toLocaleString() ?? 0}</span>
        {isMyTurn && <span className="mtv-badge-turn">YOUR TURN</span>}
        {canDraw && <span className="mtv-badge-turn">YOUR DRAW</span>}
        {!isPrimary && onLeave && <button className="mtv-leave-btn" onClick={onLeave} title="Leave table">×</button>}
      </div>

      <div className="mtv-community-row">
        {Array.from({ length: 5 }, (_, i) => <CardSlot key={i} card={communityCards[i] || null} />)}
      </div>

      <PlayerStrip players={players} currentTurn={currentTurn} />

      {/* R2 (APPUI-21) — every hole card of the variant (Omaha 4-6, Stud up
          to 7, Draw 5); it always drew exactly two slots. */}
      <div className={`mtv-hero-cards${holeSlots > 2 ? ' mtv-hero-cards--many' : ''}`}>
        {Array.from({ length: holeSlots }, (_, i) => (
          <CardSlot
            key={i}
            card={heroCards?.[i] || null}
            large={holeSlots <= 4}
            onPick={canDrawHere && heroCards?.[i] ? () => toggleDiscard(i) : undefined}
            picked={canDrawHere && discards.includes(i)}
          />
        ))}
      </div>

      {/* Gameplay audit G176 (2026-10-21) — a draw round has no betting turn:
          his draw (Stand Pat / Draw N) instead of Fold / Call / Raise, which
          the stale turn pointer used to offer here. */}
      {canDrawHere && (
        <div className="mtv-action-row mtv-draw-row">
          <button
            className="mtv-btn mtv-btn-call"
            onClick={() => {
              const sent = onAction?.draw?.([...discards].sort((a, b) => a - b));
              if (sent !== false) setPicked({ key: drawKey, list: [], sent: true }); // false = socket down: try again
            }}
          >
            {discards.length === 0 ? 'Stand Pat' : `Draw ${discards.length}`}
          </button>
        </div>
      )}
      {canDrawHere && <div className="mtv-draw-hint">Tap cards to discard</div>}
      {isDrawRound && !canDrawHere && inHand && (
        <div className="mtv-draw-hint">Waiting for others to draw</div>
      )}

      {isMyTurn && (
        <div className="mtv-action-row">
          {callAmount > 0 && (
            <button className="mtv-btn mtv-btn-fold" onClick={() => onAction?.fold()}>Fold</button>
          )}
          {/* R2 (APPUI-21) — nothing to call is a CHECK (a 'call' there was
              refused by the server). */}
          <button className="mtv-btn mtv-btn-call" onClick={() => (callAmount > 0 ? onAction?.call() : onAction?.check?.())}>
            {callAmount > 0 ? `Call ${callAmount.toLocaleString()}` : 'Check'}
          </button>
          {/* Gameplay audit F12 (2026-10-21) — not when the server says the
              betting is not open to him (canRaise === false) or at an
              All-In-or-Fold table (a 'raise' is refused there). */}
          {canRaise && (
            <button className="mtv-btn mtv-btn-raise" onClick={() => onAction?.raise()}>Raise</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar slot item ────────────────────────────────────────────────────────
function SlotItem({ tableData, isActive, onClick }) {
  let dotClass = 'mtv-dot-gray';
  let statusLabel = 'Waiting';
  if (tableData) {
    if (tableData.status && tableData.status !== 'playing') {
      dotClass = tableData.status === 'error' ? 'mtv-dot-gray' : 'mtv-dot-blue';
      statusLabel = tableData.status === 'error' ? 'Error' : 'Joining';
    } else if (tableData.isMyTurn) {
      dotClass = 'mtv-dot-green'; statusLabel = 'Your turn';
    } else if (tableData.canDraw) {
      dotClass = 'mtv-dot-green'; statusLabel = 'Your draw';
    }
  }
  return (
    <div
      className={`mtv-slot-item${isActive ? ' mtv-slot-active' : ''}${!tableData ? ' mtv-slot-empty' : ''}`}
      onClick={onClick}
    >
      <span className={`mtv-dot ${dotClass}`} />
      <div className="mtv-slot-info">
        <span className="mtv-slot-name">{tableData ? (tableData.tableName || 'Table') : 'Empty slot'}</span>
        {tableData && (
          <span className="mtv-slot-meta">
            {(tableData.players?.length ?? 0)}/{tableData.maxSeats ?? 9} ·&nbsp;
            {(tableData.pot ?? 0).toLocaleString()} chips
          </span>
        )}
      </div>
      {tableData && <span className="mtv-slot-status">{statusLabel}</span>}
    </div>
  );
}

// ─── Add-table picker ─────────────────────────────────────────────────────────
function AddTableModal({ excludeIds, onClose, onPick }) {
  const [tables, setTables] = useState(null);
  useEffect(() => {
    const s = getSocket();
    if (!s) { setTables([]); return undefined; }
    const onList = (list) => setTables(Array.isArray(list) ? list : []);
    s.on('tableList', onList);
    s.emit('getTableList');
    return () => s.off('tableList', onList);
  }, []);
  const available = (tables || []).filter((t) => !excludeIds.includes(t.tableId) && (t.playerCount ?? 0) < (t.maxSeats ?? 9));
  return (
    <div className="mtv-add-overlay" onClick={onClose}>
      <div className="mtv-add-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mtv-add-title">Add a Table</div>
        {tables === null ? (
          <div className="mtv-add-empty">Loading tables…</div>
        ) : available.length === 0 ? (
          <div className="mtv-add-empty">No open tables available.</div>
        ) : (
          <div className="mtv-add-list">
            {available.map((t) => (
              <button key={t.tableId} className="mtv-add-row" onClick={() => onPick(t)}>
                <span className="mtv-add-row-name">{t.tableName}</span>
                <span className="mtv-add-row-meta">{t.variantName} · {t.smallBlind}/{t.bigBlind} · {t.playerCount}/{t.maxSeats}</span>
              </button>
            ))}
          </div>
        )}
        <button className="mtv-add-close" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────
function mapGameStateToPanel(gs, { isPrimary }) {
  if (!gs) return null;
  const yourSeat = gs.mySeatIndex ?? gs.yourSeat ?? -1;
  const heroSeat = (gs.seats || [])[yourSeat];
  const inHand = heroSeat && !heroSeat.folded && yourSeat >= 0;
  const heroCardList = gs.yourCards || gs.hand || gs.heroCards || [];
  // Gameplay audit G176 (2026-10-21) — a draw round (Draw / Triple Draw /
  // Badugi) has no betting turn: the server leaves the turn pointer and the
  // bet to match on the last betting round, so the tile showed YOUR TURN with
  // Fold / Call / Raise and no way to draw (stood pat after 30s every round).
  const isDrawRound = !!(gs.hasDrawPhase && gs.isDrawPhase);
  const draw = drawTurnInfo(gs, { yourSeat, yourCardsLen: heroCardList.length, myPlayer: heroSeat });
  const active = isDrawRound ? -1 : (gs.activeSeatIndex ?? gs.currentTurn ?? -1);
  const callAmount = isDrawRound ? 0 : Math.max(0, (gs.currentBetToMatch ?? 0) - (heroSeat?.currentBet ?? 0));
  return {
    tableId: gs.tableId,
    tableName: gs.tableName || 'Table',
    maxSeats: 9,
    pot: gs.pot ?? 0,
    currentTurn: active,
    mySeatIndex: yourSeat,
    isMyTurn: !isDrawRound && active === yourSeat && yourSeat >= 0 && !!inHand,
    isDrawRound,
    canDraw: draw.canDrawNow,
    drawKey: drawSelectionKey(gs),
    inHand: !!inHand,
    callAmount,
    canRaise: gs.canRaise !== false && !isAllInOrFoldTable(gs),
    players: (gs.seats || [])
      .map((s, i) => (s && s.playerName ? {
        seatIndex: s.seatIndex ?? i,
        name: s.playerName,
        chips: s.chipCount ?? s.chips ?? 0,
        isFolded: s.folded,
        isActing: (s.seatIndex ?? i) === active,
      } : null))
      .filter(Boolean),
    communityCards: (gs.communityCards || []).map((c) => c?.display || c),
    heroCards: heroCardList.map((c) => c?.display || c),
    holeCardCount: Number(gs.holeCardCount) || 2,
    isPrimary,
  };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MultiTableView({ onClose }) {
  const { gameState, sendAction, sendDraw, currentTableId } = useTableStore();
  const { playerName, chips, avatar } = useGameStore();

  const [secondary, setSecondary] = useState([]); // from multiTableManager
  const [activeSlot, setActiveSlot] = useState(0); // 0 = primary
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => subscribeMultiTables(setSecondary), []);

  // Safety: when this view closes, leave all SECONDARY tables. Staying seated
  // with no visible UI would auto-fold those hands on every turn timeout, so
  // multi-tabling is scoped to while the view is open. The primary table
  // (slot 0) is untouched — it lives on the app's main socket.
  useEffect(() => () => { disconnectAllMultiTables(); }, []);

  // Hands/hr tracking (primary table)
  const handsLogRef = useRef([]);
  const [handsPerHour, setHandsPerHour] = useState(0);
  useEffect(() => {
    if (gameState?.handNumber != null) {
      const now = Date.now();
      handsLogRef.current.push({ count: gameState.handNumber, ts: now });
      handsLogRef.current = handsLogRef.current.filter((e) => now - e.ts < 60000);
      const log = handsLogRef.current;
      if (log.length >= 2) {
        const span = (log[log.length - 1].ts - log[0].ts) / 1000 / 3600;
        const delta = log[log.length - 1].count - log[0].count;
        if (span > 0) setHandsPerHour(Math.round(delta / span));
      }
    }
  }, [gameState?.handNumber]);

  // Build the unified slot list: [primary, ...secondary]
  const primaryPanel = mapGameStateToPanel(
    gameState ? { ...gameState, tableId: gameState.tableId || currentTableId || 'main' } : null,
    { isPrimary: true }
  );
  const secondaryPanels = secondary.map((s) => {
    const panel = s.gameState ? mapGameStateToPanel(s.gameState, { isPrimary: false }) : null;
    return {
      ...(panel || { tableName: s.tableName, isPrimary: false }),
      slotId: s.id,
      status: s.status,
      error: s.error,
    };
  });
  const panels = [primaryPanel, ...secondaryPanels];
  const tableCount = panels.filter(Boolean).length || 1;
  const canAdd = secondary.length < MAX_SECONDARY_TABLES;

  // Net chips this session.
  // 2026-07-06 audit P3 — was `chips - 10000`, a hardcoded starting-stack guess
  // that's wrong for anyone whose balance isn't 10k. Capture the balance when
  // the multi-table view first opens and show the delta since — an honest,
  // self-contained baseline (no fabricated starting stack).
  const sessionStartChipsRef = useRef(null);
  if (sessionStartChipsRef.current == null && typeof chips === 'number') {
    sessionStartChipsRef.current = chips;
  }
  const netChips = (chips ?? 0) - (sessionStartChipsRef.current ?? chips ?? 0);
  const netLabel = netChips >= 0 ? `+${netChips.toLocaleString()}` : netChips.toLocaleString();
  const activePanel = panels[activeSlot];
  const activeTableName = activePanel?.tableName ?? 'None';

  const gridCols = panels.length <= 1 ? 1 : 2;
  // R2 (APPUI-21) — the keyboard's C is Check when nothing is owed.
  const activeOwes = (panels[activeSlot]?.callAmount || 0) > 0;
  // Gameplay audit F12 — R raises only where the panel offers Raise.
  const activeCanRaise = panels[activeSlot]?.canRaise !== false;
  // G176 — F / C / R only on his betting turn (never in a draw round).
  const activeIsMyTurn = panels[activeSlot]?.isMyTurn === true;

  const makeActionHandler = useCallback((idx) => {
    if (idx === 0) {
      return {
        fold: () => sendAction('fold'),
        call: () => sendAction('call'),
        check: () => sendAction('check'),
        raise: () => sendAction('raise', computeMinRaiseTo(gameState)), // #10: send a valid amount
        // G176 (fix-up) — false = the primary socket is down, nothing was
        // sent: the tile keeps Stand Pat / Draw N to try again (sendDraw only
        // warns then, and the tile hid its draw for the round).
        draw: (discardIndices) => {
          if (!getSocket()?.connected) return false;
          sendDraw(discardIndices);
          return true;
        },
      };
    }
    const slot = secondary[idx - 1];
    if (!slot) return {};
    return {
      fold: () => sendMultiTableAction(slot.id, 'fold'),
      call: () => sendMultiTableAction(slot.id, 'call'),
      check: () => sendMultiTableAction(slot.id, 'check'),
      raise: () => sendMultiTableAction(slot.id, 'raise', computeMinRaiseTo(slot.gameState)), // #10
      draw: (discardIndices) => sendMultiTableDraw(slot.id, discardIndices), // G176
    };
  }, [sendAction, sendDraw, secondary, gameState]);

  // Keyboard shortcuts (act on the active slot)
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key >= '1' && e.key <= '4') { setActiveSlot(Math.min(panels.length - 1, Number(e.key) - 1)); return; }
      if (e.key === 'Escape') { onClose?.(); return; }
      if (!activeIsMyTurn) return;
      const act = makeActionHandler(activeSlot);
      if (e.key === 'f' || e.key === 'F') { if (activeOwes) act.fold?.(); }
      else if (e.key === 'c' || e.key === 'C') { if (activeOwes) act.call?.(); else act.check?.(); }
      else if (e.key === 'r' || e.key === 'R') { if (activeCanRaise) act.raise?.(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSlot, panels.length, activeOwes, activeCanRaise, activeIsMyTurn, makeActionHandler, onClose]);

  const handlePick = (t) => {
    setShowAdd(false);
    joinMultiTable(t.tableId, {
      playerName: playerName || 'Player',
      buyIn: t.minBuyIn || 0,
      avatar,
      expectedVariant: t.variant,
    });
  };

  const excludeIds = [
    gameState?.tableId || currentTableId,
    ...secondary.map((s) => s.tableId),
  ].filter(Boolean);

  return (
    <div className="mtv-overlay" role="dialog" aria-label="Multi-Table View">
      <div className="mtv-stats-bar">
        <div className="mtv-stats-left">
          <span className="mtv-title">⊞ Multi-Table</span>
        </div>
        <div className="mtv-stats-center">
          <span>{tableCount} Table{tableCount !== 1 ? 's' : ''}</span>
          <span className="mtv-sep">·</span>
          <span>{handsPerHour} hands/hr</span>
          <span className="mtv-sep">·</span>
          <span className={`mtv-net ${netChips >= 0 ? 'mtv-net-pos' : 'mtv-net-neg'}`}>Net: {netLabel}</span>
          <span className="mtv-sep">·</span>
          <span>Active: {activeTableName}</span>
        </div>
        <div className="mtv-stats-right">
          <button className="mtv-close-btn" onClick={onClose} aria-label="Close multi-table view">×</button>
        </div>
      </div>

      <div className="mtv-main">
        {/* Left sidebar */}
        <div className="mtv-sidebar">
          <div className="mtv-sidebar-label">Tables</div>
          {panels.map((panel, i) => (
            <SlotItem key={i} tableData={panel} isActive={activeSlot === i} onClick={() => setActiveSlot(i)} />
          ))}
          <button
            className="mtv-btn-add-table"
            onClick={() => setShowAdd(true)}
            disabled={!canAdd}
            title={canAdd ? 'Join another table' : 'Maximum tables reached'}
          >
            ＋ Add Table
          </button>
        </div>

        {/* Panel grid */}
        <div className="mtv-grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
          {panels.map((panel, i) => (
            <MiniTablePanel
              key={i}
              tableData={panel}
              isActive={activeSlot === i}
              onAction={makeActionHandler(i)}
              onLeave={i > 0 && panel?.slotId ? () => leaveMultiTable(panel.slotId) : undefined}
            />
          ))}
        </div>
      </div>

      {showAdd && (
        <AddTableModal excludeIds={excludeIds} onClose={() => setShowAdd(false)} onPick={handlePick} />
      )}
    </div>
  );
}
