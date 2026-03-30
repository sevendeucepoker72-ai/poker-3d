import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTableStore } from '../../store/tableStore';
import { useGameStore } from '../../store/gameStore';
import './MultiTableView.css';

// ─── Simulated data helpers ───────────────────────────────────────────────────

const MOCK_NAMES = [
  'TexasKing', 'BluffMaster', 'RiverRat', 'AceHigh', 'FlopStar',
  'NightOwl', 'ColdCall', 'AllInAnna', 'RaiseBob', 'CheckChris',
];

const MOCK_TABLE_NAMES = ['Table Vegas', 'High Roller', 'The Shark Tank', 'Low Stakes'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildMockTableData(slotIndex) {
  const playerCount = randomInt(4, 9);
  const players = Array.from({ length: playerCount }, (_, i) => ({
    seatIndex: i,
    name: MOCK_NAMES[randomInt(0, MOCK_NAMES.length - 1)],
    chips: randomInt(800, 12000),
    isActing: i === randomInt(0, playerCount - 1),
    isFolded: false,
  }));
  const communityCount = randomInt(0, 5);
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const communityCards = Array.from({ length: communityCount }, () => ({
    rank: ranks[randomInt(0, ranks.length - 1)],
    suit: suits[randomInt(0, suits.length - 1)],
  }));
  return {
    tableId: `mock-${slotIndex}`,
    tableName: MOCK_TABLE_NAMES[slotIndex % MOCK_TABLE_NAMES.length],
    playerCount,
    maxSeats: 9,
    pot: randomInt(200, 8000),
    phase: 'Betting',
    currentTurn: -1,
    mySeatIndex: -1,
    players,
    communityCards,
    heroCards: [],
    isMock: true,
  };
}

// ─── Card display helpers ─────────────────────────────────────────────────────

function parseCard(cardStr) {
  if (!cardStr) return null;
  const str = String(cardStr);
  const suit = str.slice(-1);
  const rank = str.slice(0, -1);
  return { rank, suit };
}

function isRedSuit(suit) {
  return suit === '♥' || suit === '♦';
}

function CardSlot({ card, large = false }) {
  if (!card) {
    return <span className={`mtv-card mtv-card-empty${large ? ' mtv-card-large' : ''}`}>🂠</span>;
  }
  const { rank, suit } = typeof card === 'string' ? (parseCard(card) || { rank: '?', suit: '?' }) : card;
  const red = isRedSuit(suit);
  return (
    <span className={`mtv-card${large ? ' mtv-card-large' : ''} ${red ? 'suit-red' : 'suit-black'}`}>
      {rank}{suit}
    </span>
  );
}

// ─── Player avatar strip ──────────────────────────────────────────────────────

function PlayerStrip({ players = [], currentTurn }) {
  return (
    <div className="mtv-player-strip">
      {players.map((p, i) => {
        const isActing = p.seatIndex === currentTurn || p.isActing;
        return (
          <div key={i} className={`mtv-avatar-wrap${isActing ? ' mtv-avatar-acting' : ''}`}>
            <div
              className={`mtv-avatar-circle${isActing ? ' mtv-avatar-glow' : ''}`}
              style={{ background: `hsl(${(p.seatIndex * 47 + 17) % 360}, 55%, 42%)` }}
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

// ─── Mini table panel ─────────────────────────────────────────────────────────

function MiniTablePanel({ tableData, isActive, onAction }) {
  const [preActions, setPreActions] = useState({ foldAny: false, checkFold: false, callAny: false });

  if (!tableData) {
    return (
      <div className="mtv-panel mtv-panel-empty">
        <div className="mtv-panel-empty-label">No table joined</div>
        <button className="mtv-btn-add-inside" onClick={onAction?.addTable}>＋ Add Table</button>
      </div>
    );
  }

  const {
    tableName, pot, phase, currentTurn, mySeatIndex,
    players = [], communityCards = [], heroCards = [], isMock,
  } = tableData;

  const isMyTurn = !isMock && phase === 'Betting' && currentTurn === mySeatIndex && mySeatIndex >= 0;
  const callAmount = players[mySeatIndex]?.callAmount || 0;

  const togglePre = (key) => setPreActions((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className={`mtv-panel${isActive ? ' mtv-panel-active' : ''}${isMyTurn ? ' mtv-panel-myturn' : ''}`}>
      {/* Panel header */}
      <div className="mtv-panel-header">
        <span className="mtv-panel-name">{tableName}</span>
        <span className="mtv-panel-pot">Pot: {pot?.toLocaleString() ?? 0}</span>
        {isMyTurn && <span className="mtv-badge-turn">YOUR TURN</span>}
      </div>

      {/* Community cards */}
      <div className="mtv-community-row">
        {Array.from({ length: 5 }, (_, i) => {
          const c = communityCards[i];
          return <CardSlot key={i} card={c || null} />;
        })}
      </div>

      {/* Player seats */}
      <PlayerStrip players={players} currentTurn={currentTurn} />

      {/* Hero hole cards */}
      <div className="mtv-hero-cards">
        <CardSlot card={heroCards?.[0] || null} large />
        <CardSlot card={heroCards?.[1] || null} large />
      </div>

      {/* Action row */}
      {isMyTurn && (
        <div className="mtv-action-row">
          <button className="mtv-btn mtv-btn-fold" onClick={() => onAction?.fold()}>
            Fold
          </button>
          <button className="mtv-btn mtv-btn-call" onClick={() => onAction?.call()}>
            {callAmount > 0 ? `Call $${callAmount.toLocaleString()}` : 'Check'}
          </button>
          <button className="mtv-btn mtv-btn-raise" onClick={() => onAction?.raise()}>
            Raise
          </button>
        </div>
      )}

      {/* Pre-action queue */}
      <div className="mtv-preaction-row">
        <label className="mtv-precheck">
          <input
            type="checkbox"
            checked={preActions.foldAny}
            onChange={() => togglePre('foldAny')}
          />
          <span>Fold any</span>
        </label>
        <label className="mtv-precheck">
          <input
            type="checkbox"
            checked={preActions.checkFold}
            onChange={() => togglePre('checkFold')}
          />
          <span>Check/fold</span>
        </label>
        <label className="mtv-precheck">
          <input
            type="checkbox"
            checked={preActions.callAny}
            onChange={() => togglePre('callAny')}
          />
          <span>Call any</span>
        </label>
      </div>
    </div>
  );
}

// ─── Sidebar slot item ────────────────────────────────────────────────────────

function SlotItem({ slot, tableData, isActive, onClick }) {
  let dotClass = 'mtv-dot-gray';
  let statusLabel = 'Waiting';

  if (tableData) {
    if (tableData.isMock) {
      dotClass = 'mtv-dot-blue';
      statusLabel = 'Spectating';
    } else {
      const isMyTurn =
        tableData.phase === 'Betting' &&
        tableData.currentTurn === tableData.mySeatIndex &&
        tableData.mySeatIndex >= 0;
      dotClass = isMyTurn ? 'mtv-dot-green' : 'mtv-dot-gray';
      statusLabel = isMyTurn ? 'Your turn' : 'Waiting';
    }
  }

  return (
    <div
      className={`mtv-slot-item${isActive ? ' mtv-slot-active' : ''}${!tableData ? ' mtv-slot-empty' : ''}`}
      onClick={onClick}
    >
      <span className={`mtv-dot ${dotClass}`} />
      <div className="mtv-slot-info">
        <span className="mtv-slot-name">{tableData ? tableData.tableName : slot.tableName}</span>
        {tableData ? (
          <span className="mtv-slot-meta">
            {tableData.playerCount}/{tableData.maxSeats} &nbsp;·&nbsp;
            {(tableData.pot ?? 0).toLocaleString()} chips
          </span>
        ) : (
          <span className="mtv-slot-meta">Empty slot</span>
        )}
      </div>
      {tableData && <span className="mtv-slot-status">{statusLabel}</span>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MultiTableView({ onClose }) {
  const { gameState, sendAction, activeTables, currentTableId, switchActiveTable } = useTableStore();
  const { playerName, chips } = useGameStore();

  // Slot state: 4 fixed slots
  const [slots] = useState([
    { tableId: null, tableName: 'Slot 1' },
    { tableId: null, tableName: 'Slot 2' },
    { tableId: null, tableName: 'Slot 3' },
    { tableId: null, tableName: 'Slot 4' },
  ]);

  const [activeSlot, setActiveSlot] = useState(0);
  const [mockData] = useState(() => [
    null,
    buildMockTableData(1),
    buildMockTableData(2),
    buildMockTableData(3),
  ]);

  // Hands/hr tracking
  const handCountRef = useRef(0);
  const handsLogRef = useRef([]); // [{count, ts}]
  const [handsPerHour, setHandsPerHour] = useState(84);

  useEffect(() => {
    if (gameState?.handNumber != null) {
      const now = Date.now();
      handsLogRef.current.push({ count: gameState.handNumber, ts: now });
      // Keep last 60 seconds of data
      handsLogRef.current = handsLogRef.current.filter((e) => now - e.ts < 60000);
      const log = handsLogRef.current;
      if (log.length >= 2) {
        const span = (log[log.length - 1].ts - log[0].ts) / 1000 / 3600; // hours
        const delta = log[log.length - 1].count - log[0].count;
        if (span > 0) setHandsPerHour(Math.round(delta / span));
      }
    }
  }, [gameState?.handNumber]);

  // Build table data for each slot
  const getSlotTableData = useCallback(
    (slotIdx) => {
      if (slotIdx === 0) {
        if (!gameState) return null;
        return {
          tableId: currentTableId || 'main',
          tableName: gameState.tableName || 'Table Vegas',
          playerCount: (gameState.seats || []).filter(Boolean).length,
          maxSeats: 9,
          pot: gameState.pot ?? 0,
          phase: gameState.phase,
          currentTurn: gameState.currentTurn,
          mySeatIndex: gameState.mySeatIndex ?? gameState.yourSeat ?? -1,
          players: (gameState.seats || [])
            .map((s, i) => s ? { seatIndex: i, name: s.name, chips: s.chips, isFolded: s.folded } : null)
            .filter(Boolean),
          communityCards: (gameState.communityCards || []).map((c) => parseCard(c) || c),
          heroCards: (gameState.hand || gameState.heroCards || []).map((c) => parseCard(c) || c),
          isMock: false,
        };
      }
      return mockData[slotIdx] || null;
    },
    [gameState, currentTableId, mockData]
  );

  // Net chips — just use current chips vs default 10000 as a proxy
  const netChips = chips - 10000;
  const netLabel = netChips >= 0 ? `+${netChips.toLocaleString()}` : netChips.toLocaleString();

  // Active table name for the stats bar
  const activeTableData = getSlotTableData(activeSlot);
  const activeTableName = activeTableData?.tableName ?? 'None';

  // Count non-empty slots
  const filledSlots = slots.filter((_, i) => getSlotTableData(i) !== null);
  const tableCount = filledSlots.length || 1;

  // Grid columns
  const gridCols = tableCount === 1 ? 1 : 2;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case '1': setActiveSlot(0); break;
        case '2': setActiveSlot(1); break;
        case '3': setActiveSlot(2); break;
        case '4': setActiveSlot(3); break;
        case 'Escape': onClose?.(); break;
        case 'f':
        case 'F':
          if (activeSlot === 0 && gameState) sendAction('fold');
          break;
        case 'c':
        case 'C':
          if (activeSlot === 0 && gameState) sendAction('call');
          break;
        case 'r':
        case 'R':
          if (activeSlot === 0 && gameState) sendAction('raise');
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSlot, gameState, onClose, sendAction]);

  const makeActionHandler = (slotIdx) => {
    if (slotIdx !== 0) return {};
    return {
      fold: () => sendAction('fold'),
      call: () => sendAction('call'),
      raise: () => sendAction('raise'),
      addTable: () => {},
    };
  };

  return (
    <div className="mtv-overlay" role="dialog" aria-label="Multi-Table View">
      {/* Top stats bar */}
      <div className="mtv-stats-bar">
        <div className="mtv-stats-left">
          <span className="mtv-title">⊞ Multi-Table</span>
        </div>
        <div className="mtv-stats-center">
          <span>{tableCount} Table{tableCount !== 1 ? 's' : ''}</span>
          <span className="mtv-sep">·</span>
          <span>{handsPerHour} hands/hr</span>
          <span className="mtv-sep">·</span>
          <span className={`mtv-net ${netChips >= 0 ? 'mtv-net-pos' : 'mtv-net-neg'}`}>
            Net: {netLabel}
          </span>
          <span className="mtv-sep">·</span>
          <span>Active: {activeTableName}</span>
        </div>
        <div className="mtv-stats-right">
          <button className="mtv-close-btn" onClick={onClose} aria-label="Close multi-table view">
            ×
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="mtv-main">
        {/* Left sidebar */}
        <div className="mtv-sidebar">
          <div className="mtv-sidebar-label">Tables</div>
          {slots.map((slot, i) => (
            <SlotItem
              key={i}
              slot={slot}
              tableData={getSlotTableData(i)}
              isActive={activeSlot === i}
              onClick={() => {
                setActiveSlot(i);
                if (i === 0 && currentTableId) switchActiveTable(currentTableId);
              }}
            />
          ))}
          <button className="mtv-btn-add-table">＋ Add Table</button>
        </div>

        {/* Panel grid */}
        <div
          className="mtv-grid"
          style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
        >
          {slots.map((slot, i) => (
            <MiniTablePanel
              key={i}
              tableData={getSlotTableData(i)}
              isActive={activeSlot === i}
              onAction={makeActionHandler(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
