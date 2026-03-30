import React, { useState, useRef, useCallback } from 'react';
import { recordHandStats } from '../../utils/opponentTracker';
import './HandHistoryImporter.css';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseHandHistory(text) {
  const blocks = text.split(/(?=PokerStars Hand #)/);
  const hands = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith('PokerStars Hand #')) continue;

    const hand = parseBlock(trimmed);
    if (hand) hands.push(hand);
  }

  return hands;
}

function parseBlock(block) {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // ── Header line ──────────────────────────────────────────────────────────
  // PokerStars Hand #123456: Hold'em No Limit ($0.25/$0.50) - 2024/01/15 20:30:00
  const headerMatch = lines[0].match(
    /PokerStars Hand #(\d+).*?\(\$?([\d.]+)\/\$?([\d.]+)\).*?-\s*([\d/]+ [\d:]+)/
  );
  if (!headerMatch) return null;

  const handId = headerMatch[1];
  const sb = parseFloat(headerMatch[2]);
  const bb = parseFloat(headerMatch[3]);
  const date = headerMatch[4];

  // ── Seats ─────────────────────────────────────────────────────────────────
  const players = [];
  for (const line of lines) {
    const m = line.match(/^Seat \d+: (.+?) \(\$?([\d.]+) in chips\)/);
    if (m) players.push({ name: m[1].trim(), stack: parseFloat(m[2]) });
  }

  // ── Button seat ───────────────────────────────────────────────────────────
  const btnMatch = block.match(/Seat #(\d+) is the button/);
  const btnSeat = btnMatch ? parseInt(btnMatch[1]) : null;

  // Map seat number → position label
  const seatLineRe = /Seat (\d+): (.+?) \(\$?[\d.]+ in chips\)/g;
  const seatOrder = [];
  let sm;
  while ((sm = seatLineRe.exec(block)) !== null) {
    seatOrder.push({ num: parseInt(sm[1]), name: sm[2].trim() });
  }
  const positionMap = buildPositionMap(seatOrder, btnSeat);

  // ── Hero cards ────────────────────────────────────────────────────────────
  let heroCards = null;
  const holeMatch = block.match(/Dealt to Hero \[([^\]]+)\]/);
  if (holeMatch) {
    heroCards = holeMatch[1].split(' ').map(c => c.trim()).filter(Boolean);
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions = [];
  let currentStreet = 'PREFLOP';
  const streetCards = { FLOP: null, TURN: null, RIVER: null };

  for (const line of lines) {
    if (line.startsWith('*** HOLE CARDS ***')) { currentStreet = 'PREFLOP'; continue; }
    if (line.startsWith('*** FLOP ***')) {
      const cm = line.match(/\[([^\]]+)\]/);
      streetCards.FLOP = cm ? cm[1] : '';
      currentStreet = 'FLOP';
      continue;
    }
    if (line.startsWith('*** TURN ***')) {
      const cm = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
      streetCards.TURN = cm ? cm[2] : '';
      currentStreet = 'TURN';
      continue;
    }
    if (line.startsWith('*** RIVER ***')) {
      const cm = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
      streetCards.RIVER = cm ? cm[2] : '';
      currentStreet = 'RIVER';
      continue;
    }
    if (line.startsWith('*** SUMMARY ***') || line.startsWith('*** SHOW DOWN ***')) continue;

    // Action lines: "PlayerName: folds/calls/raises/checks/bets $X"
    const actMatch = line.match(/^(.+?): (folds|calls|raises|checks|bets|posts)(?: \$?([\d.]+))?/);
    if (actMatch && currentStreet !== 'SUMMARY') {
      actions.push({
        street: currentStreet,
        player: actMatch[1].trim(),
        action: actMatch[2],
        amount: actMatch[3] ? parseFloat(actMatch[3]) : 0,
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  let winner = null;
  let pot = 0;

  const potMatch = block.match(/Total pot \$?([\d.]+)/);
  if (potMatch) pot = parseFloat(potMatch[1]);

  const summaryStart = block.indexOf('*** SUMMARY ***');
  if (summaryStart !== -1) {
    const summaryText = block.slice(summaryStart);
    const wonMatch = summaryText.match(/Seat \d+: (.+?) (?:showed .+? and )?won \(\$?([\d.]+)\)/);
    if (wonMatch) winner = wonMatch[1].trim();
    if (!winner) {
      const collected = summaryText.match(/Seat \d+: (.+?) collected/);
      if (collected) winner = collected[1].trim();
    }
  }

  // ── Hero net ──────────────────────────────────────────────────────────────
  let heroNet = 0;
  const heroActions = actions.filter(a => a.player === 'Hero');
  const contributed = heroActions
    .filter(a => ['calls', 'raises', 'bets', 'posts'].includes(a.action))
    .reduce((sum, a) => sum + a.amount, 0);

  if (winner === 'Hero') {
    heroNet = pot - contributed;
  } else if (contributed > 0) {
    heroNet = -contributed;
  }

  // ── Hero position ─────────────────────────────────────────────────────────
  const heroPosition = positionMap['Hero'] || 'Unknown';

  return {
    handId,
    date,
    sb,
    bb,
    heroCards,
    players,
    actions,
    winner,
    pot,
    heroNet,
    heroPosition,
    streetCards,
    positionMap,
  };
}

function buildPositionMap(seatOrder, btnSeat) {
  if (!seatOrder.length) return {};
  const n = seatOrder.length;
  const btnIdx = seatOrder.findIndex(s => s.num === btnSeat);
  if (btnIdx === -1) return {};

  const labels = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO', 'MP', 'UTG+1', 'UTG+2'];
  const positions = {};
  for (let i = 0; i < n; i++) {
    const idx = (btnIdx + i) % n;
    positions[seatOrder[idx].name] = labels[i] || `Seat${i}`;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Card glyph helper
// ---------------------------------------------------------------------------

const SUIT_SYMBOLS = { s: '♠', c: '♣', h: '♥', d: '♦' };
const RED_SUITS = new Set(['h', 'd']);

function CardGlyph({ card, large = false }) {
  if (!card || card.length < 2) return null;
  const rank = card.slice(0, -1).toUpperCase();
  const suit = card.slice(-1).toLowerCase();
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const red = RED_SUITS.has(suit);
  return (
    <span className={`card-glyph${large ? ' card-glyph--large' : ''}${red ? ' card-glyph--red' : ''}`}>
      {rank}{symbol}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bar chart (SVG)
// ---------------------------------------------------------------------------

function DailyNetChart({ hands }) {
  const byDate = {};
  for (const h of hands) {
    const d = h.date ? h.date.split(' ')[0] : 'Unknown';
    byDate[d] = (byDate[d] || 0) + h.heroNet;
  }
  const entries = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return null;

  const W = 200;
  const H = 120;
  const barW = Math.max(4, Math.floor(W / (entries.length + 1)));
  const vals = entries.map(e => e[1]);
  const maxAbs = Math.max(1, ...vals.map(Math.abs));
  const midY = H / 2;

  return (
    <svg className="daily-net-chart" viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {entries.map(([, val], i) => {
        const barH = Math.abs(val) / maxAbs * (H / 2 - 4);
        const x = i * (barW + 2) + 2;
        const y = val >= 0 ? midY - barH : midY;
        const fill = val >= 0 ? '#00d97e' : '#ff4d6d';
        return <rect key={i} x={x} y={y} width={barW} height={Math.max(1, barH)} fill={fill} rx="1" />;
      })}
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="rgba(0,217,255,0.2)" strokeWidth="1" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pot progression bar
// ---------------------------------------------------------------------------

function PotProgressionBar({ actions, pot }) {
  const streets = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
  const streetTotals = streets.map(s =>
    actions.filter(a => a.street === s && ['calls', 'raises', 'bets', 'posts'].includes(a.action))
      .reduce((sum, a) => sum + a.amount, 0)
  );
  const cumulative = streetTotals.reduce((acc, val, i) => {
    acc.push((acc[i - 1] || 0) + val);
    return acc;
  }, []);
  const max = Math.max(1, pot);

  return (
    <div className="pot-progression">
      <div className="pot-progression__label">Pot progression</div>
      <div className="pot-progression__track">
        {streets.map((s, i) => {
          const pct = (cumulative[i] / max) * 100;
          return (
            <div
              key={s}
              className={`pot-progression__segment pot-progression__segment--${s.toLowerCase()}`}
              style={{ width: `${pct}%` }}
              title={`${s}: $${cumulative[i].toFixed(2)}`}
            />
          );
        })}
      </div>
      <div className="pot-progression__final">Total: ${pot.toFixed(2)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats sidebar
// ---------------------------------------------------------------------------

const POSITIONS = ['BTN', 'CO', 'HJ', 'MP', 'UTG', 'BB', 'SB'];

function StatsSidebar({ hands }) {
  const totalNet = hands.reduce((s, h) => s + h.heroNet, 0);
  const wins = hands.filter(h => h.winner === 'Hero').length;
  const winRate = hands.length ? Math.round((wins / hands.length) * 100) : 0;

  const vpipHands = hands.filter(h =>
    h.actions.some(a => a.player === 'Hero' && a.street === 'PREFLOP' &&
      ['calls', 'raises'].includes(a.action))
  ).length;
  const pfrHands = hands.filter(h =>
    h.actions.some(a => a.player === 'Hero' && a.street === 'PREFLOP' &&
      a.action === 'raises')
  ).length;

  const vpip = hands.length ? Math.round((vpipHands / hands.length) * 100) : 0;
  const pfr = hands.length ? Math.round((pfrHands / hands.length) * 100) : 0;

  const netByPos = {};
  for (const pos of POSITIONS) netByPos[pos] = 0;
  for (const h of hands) {
    const pos = h.heroPosition;
    if (netByPos[pos] !== undefined) netByPos[pos] += h.heroNet;
  }

  return (
    <aside className="hhi-sidebar">
      <div className="hhi-sidebar__stat">
        <span className="hhi-sidebar__label">Net chips</span>
        <span className={`hhi-sidebar__value ${totalNet >= 0 ? 'positive' : 'negative'}`}>
          {totalNet >= 0 ? '+' : ''}${totalNet.toFixed(2)}
        </span>
      </div>
      <div className="hhi-sidebar__stat">
        <span className="hhi-sidebar__label">Hands</span>
        <span className="hhi-sidebar__value">{hands.length}</span>
      </div>
      <div className="hhi-sidebar__stat">
        <span className="hhi-sidebar__label">Win rate</span>
        <span className="hhi-sidebar__value">{winRate}%</span>
      </div>
      <div className="hhi-sidebar__stat">
        <span className="hhi-sidebar__label">VPIP</span>
        <span className="hhi-sidebar__value">{vpip}%</span>
      </div>
      <div className="hhi-sidebar__stat">
        <span className="hhi-sidebar__label">PFR</span>
        <span className="hhi-sidebar__value">{pfr}%</span>
      </div>

      <div className="hhi-sidebar__section-title">Net by Position</div>
      <table className="hhi-pos-table">
        <tbody>
          {POSITIONS.map(pos => (
            <tr key={pos}>
              <td className="hhi-pos-table__pos">{pos}</td>
              <td className={`hhi-pos-table__net ${netByPos[pos] >= 0 ? 'positive' : 'negative'}`}>
                {netByPos[pos] >= 0 ? '+' : ''}${netByPos[pos].toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="hhi-sidebar__section-title">Daily Net</div>
      <DailyNetChart hands={hands} />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Hand detail drawer
// ---------------------------------------------------------------------------

function HandDetailDrawer({ hand, onClose }) {
  if (!hand) return null;

  const streets = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];

  return (
    <div className="hhi-drawer">
      <div className="hhi-drawer__header">
        <span className="hhi-drawer__title">Hand #{hand.handId}</span>
        <button className="hhi-drawer__close" onClick={onClose}>✕</button>
      </div>

      {hand.heroCards && (
        <div className="hhi-drawer__hero-cards">
          {hand.heroCards.map((c, i) => <CardGlyph key={i} card={c} large />)}
        </div>
      )}

      <div className="hhi-drawer__streets">
        {streets.map(street => {
          const streetActions = hand.actions.filter(a => a.street === street);
          if (!streetActions.length && street !== 'PREFLOP') return null;
          const boardCards = hand.streetCards?.[street];
          return (
            <div key={street} className="hhi-drawer__street">
              <div className="hhi-drawer__street-header">
                {street}
                {boardCards && (
                  <span className="hhi-drawer__board-cards">
                    {boardCards.split(' ').map((c, i) => <CardGlyph key={i} card={c} />)}
                  </span>
                )}
              </div>
              {streetActions.map((a, i) => (
                <div key={i} className="hhi-drawer__action">
                  <span className="hhi-drawer__action-player">{a.player}</span>
                  <span className="hhi-drawer__action-type">{a.action}</span>
                  {a.amount > 0 && (
                    <span className="hhi-drawer__action-amount">${a.amount.toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <PotProgressionBar actions={hand.actions} pot={hand.pot} />

      <div className={`hhi-drawer__result ${hand.heroNet >= 0 ? 'positive' : 'negative'}`}>
        {hand.heroNet >= 0
          ? `Hero won $${hand.heroNet.toFixed(2)}`
          : `Hero lost $${Math.abs(hand.heroNet).toFixed(2)}`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search / filter bar
// ---------------------------------------------------------------------------

function FilterBar({ filter, onChange }) {
  return (
    <div className="hhi-filter-bar">
      <input
        className="hhi-filter-bar__input"
        type="text"
        placeholder="Filter by date (YYYY/MM/DD) or min/max result (e.g. >1.00 or <-2.00)"
        value={filter}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function applyFilter(hands, filter) {
  const f = filter.trim();
  if (!f) return hands;
  const gtMatch = f.match(/^>([\d.]+)$/);
  if (gtMatch) return hands.filter(h => h.heroNet > parseFloat(gtMatch[1]));
  const ltMatch = f.match(/^<(-?[\d.]+)$/);
  if (ltMatch) return hands.filter(h => h.heroNet < parseFloat(ltMatch[1]));
  return hands.filter(h => h.date && h.date.includes(f));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export default function HandHistoryImporter({ onClose }) {
  const [hands, setHands] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [selectedHand, setSelectedHand] = useState(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const [toast, setToast] = useState('');
  const fileInputRef = useRef();

  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith('.txt')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseHandHistory(e.target.result);
      setHands(parsed);
      setPage(0);
      setSelectedHand(null);
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  }, [processFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  const onFileChange = useCallback((e) => {
    processFile(e.target.files[0]);
  }, [processFile]);

  const filteredHands = applyFilter(hands, filter);
  const pageCount = Math.ceil(filteredHands.length / PAGE_SIZE);
  const pageHands = filteredHands.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleImportToTracker = () => {
    let count = 0;
    for (const hand of hands) {
      const seats = hand.players.map((p, i) => ({
        name: p.name,
        chips: p.stack,
        position: hand.positionMap?.[p.name] || `Seat${i}`,
        isEmpty: false,
      }));
      const mySeatIndex = seats.findIndex(s => s.name === 'Hero');
      const gameState = {
        actionHistory: hand.actions.map((a, i) => ({
          seatIndex: seats.findIndex(s => s.name === a.player),
          phase: a.street,
          type: a.action,
          amount: a.amount,
          id: i,
        })),
      };
      recordHandStats(seats, mySeatIndex, gameState);
      count++;
    }
    showToast(`✓ Imported ${count} opponent profiles`);
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(hands, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hand_history.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [datePart, timePart] = dateStr.split(' ');
    if (!datePart) return dateStr;
    const [y, m, d] = datePart.split('/');
    const time = timePart ? timePart.slice(0, 5) : '';
    return `${m}/${d} ${time}`;
  };

  return (
    <div className="hhi-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hhi-panel">
        {/* Header */}
        <div className="hhi-header">
          <span className="hhi-header__title">Hand History Importer</span>
          <button className="hhi-header__close" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        {hands.length === 0 ? (
          // Drop zone
          <div
            className={`hhi-dropzone${dragging ? ' hhi-dropzone--active' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="hhi-dropzone__icon">📂</span>
            <p className="hhi-dropzone__text">Drop .txt hand history or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              className="hhi-dropzone__input"
              onChange={onFileChange}
            />
          </div>
        ) : (
          <div className="hhi-body">
            <StatsSidebar hands={hands} />

            <div className="hhi-center">
              <FilterBar filter={filter} onChange={(v) => { setFilter(v); setPage(0); }} />

              <div className="hhi-table-wrap">
                <table className="hhi-table">
                  <thead>
                    <tr>
                      <th>Hand #</th>
                      <th>Date</th>
                      <th>Stakes</th>
                      <th>Hero Hand</th>
                      <th>Result</th>
                      <th>Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageHands.map(hand => (
                      <tr
                        key={hand.handId}
                        className={`hhi-table__row${selectedHand?.handId === hand.handId ? ' hhi-table__row--selected' : ''}`}
                        onClick={() => setSelectedHand(selectedHand?.handId === hand.handId ? null : hand)}
                      >
                        <td className="hhi-table__hand-id">#{hand.handId.slice(-6)}</td>
                        <td>{formatDate(hand.date)}</td>
                        <td>NL${(hand.bb * 2).toFixed(2)}</td>
                        <td className="hhi-table__cards">
                          {hand.heroCards
                            ? hand.heroCards.map((c, i) => <CardGlyph key={i} card={c} />)
                            : <span className="hhi-muted">—</span>}
                        </td>
                        <td className={hand.heroNet >= 0 ? 'positive' : 'negative'}>
                          {hand.heroNet >= 0 ? '+' : ''}${hand.heroNet.toFixed(2)}
                        </td>
                        <td>{hand.winner || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="hhi-pagination">
                <button
                  className="hhi-btn"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  ← Prev
                </button>
                <span className="hhi-pagination__info">
                  Page {page + 1} of {Math.max(1, pageCount)} ({filteredHands.length} hands)
                </span>
                <button
                  className="hhi-btn"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next →
                </button>
              </div>
            </div>

            {selectedHand && (
              <HandDetailDrawer
                hand={selectedHand}
                onClose={() => setSelectedHand(null)}
              />
            )}
          </div>
        )}

        {/* Bottom bar */}
        {hands.length > 0 && (
          <div className="hhi-bottom-bar">
            <button className="hhi-btn hhi-btn--secondary" onClick={() => fileInputRef.current?.click()}>
              Load New File
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                className="hhi-dropzone__input"
                onChange={onFileChange}
              />
            </button>
            <button className="hhi-btn hhi-btn--primary" onClick={handleImportToTracker}>
              Import to Opponent Tracker
            </button>
            <button className="hhi-btn hhi-btn--secondary" onClick={handleExportJSON}>
              Export JSON
            </button>
          </div>
        )}

        {/* Toast */}
        {toast && <div className="hhi-toast">{toast}</div>}
      </div>
    </div>
  );
}
