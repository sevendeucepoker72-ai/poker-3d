import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore, serverWinRate } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { ownHandResult, cardText } from '../../utils/handLog';
// The panel uses the Leak Finder's panel styles (it never loaded them itself).
import './LeakFinder.css';

// 2026-10-11 (.online R2 — APPUI-51). Exports are the player's OWN data:
// - hand history = his row of each hand in the lobby hand log (the hands the
//   server keeps for him + this session's; his seat per hand from
//   utils/handLog), never another player's row matched by name or the seat he
//   happens to hold now;
// - stats = the server's playerProgress counters, plus the server's recent
//   chip counts (chipHistory: numbers, one per hand).
// Nothing is exported that the app does not actually have; amounts are
// play-money chips.

function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cardsStr = (cards) => (Array.isArray(cards) ? cards.map(cardText).filter(Boolean).join(' ') : '');

/**
 * CSV text of his own hands (null when he has none). Exported for tests.
 * Sit & Go fix-all C2 — one appended last column 'Kind' (Cash / Tournament:
 * a tournament hand's chips are table chips, not his bankroll).
 */
export function ownHandsCsv(handLog, myName, ctx = {}) {
  const rows = [];
  for (const h of Array.isArray(handLog) ? handLog : []) {
    const r = ownHandResult(h, myName, ctx);
    if (!r) continue;
    const when = h.timestamp || h.receivedAt;
    rows.push([
      h.handNumber ?? '',
      when ? new Date(when).toLocaleString() : '',
      h.tableName || '',
      r.seat + 1,
      cardsStr(r.holeCards),
      cardsStr(h.communityCards),
      r.handName || '',
      r.pot,
      r.won ? 'Won' : (r.folded ? 'Folded' : 'Lost'),
      r.won ? r.chipsWon : 0,
      typeof r.net === 'number' ? r.net : '',
      r.tournament ? 'Tournament' : 'Cash',
    ]);
  }
  if (rows.length === 0) return null;
  const headers = ['Hand #', 'Played', 'Table', 'Your Seat', 'Your Cards', 'Board', 'Your Hand', 'Pot', 'Result', 'Chips Won', 'Net Chips', 'Kind'];
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/** CSV text of his server stats. Exported for tests. */
export function statsCsv(p) {
  const totalHands = Number(p.totalHandsPlayed) || 0;
  const handsWon = Math.min(totalHands, Number(p.handsWon) || 0);
  const playerStats = {
    Level: p.level ?? 1,
    'XP into level': p.xp ?? 0,
    'Season XP': p.totalXp ?? 0,
    Chips: p.chips ?? 0,
    Stars: p.stars ?? 0,
    'Total Hands': totalHands,
    'Hands Won': handsWon,
    'Win Rate %': serverWinRate(p),
    'Biggest Pot': p.biggestPot ?? 0,
    'Best Streak': p.bestStreak ?? 0,
    ELO: p.elo ?? 500,
    'Peak ELO': p.peakElo ?? p.elo ?? 500,
    'Daily Login Streak': p.loginStreak ?? 0,
  };
  const lines = [];
  lines.push(['American Pub Poker — stats export (play money)']);
  lines.push(['Generated', new Date().toLocaleString()]);
  lines.push([]);
  lines.push(['Stat', 'Value']);
  for (const [key, value] of Object.entries(playerStats)) lines.push([key, String(value)]);
  const history = (Array.isArray(p.chipHistory) ? p.chipHistory : []).map(Number).filter(Number.isFinite);
  lines.push([]);
  lines.push(['Chip count after each of your last hands (oldest first)']);
  lines.push(['Hand', 'Chips']);
  history.forEach((c, i) => lines.push([`-${history.length - i}`, String(c)]));
  if (history.length === 0) lines.push(['(none recorded yet)', '']);
  return lines.map((r) => r.map(csvCell).join(',')).join('\n');
}

export default function ExportData({ onClose }) {
  const [note, setNote] = useState(null);
  const exportHandHistory = () => {
    const { handLog, tournamentTableIds } = useProgressStore.getState();
    const csv = ownHandsCsv(handLog, useGameStore.getState().playerName, { tournamentTableIds });
    if (!csv) { setNote('No hands of yours recorded yet — play some hands first.'); return; }
    downloadCSV(`poker_hand_history_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setNote(null);
  };
  const exportSessionStats = () => {
    downloadCSV(`poker_stats_${new Date().toISOString().slice(0, 10)}.csv`, statsCsv(useProgressStore.getState().progress || {}));
    setNote(null);
  };
  return createPortal(
    <div className="leak-finder-overlay" onClick={onClose}>
      <div
        className="leak-finder-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '400px' }}
      >
        <div className="leak-finder-header">
          <div className="leak-finder-title">Export Data</div>
          <button className="leak-finder-close" onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
          <button
            onClick={exportHandHistory}
            style={{
              padding: '14px 20px',
              border: '1px solid rgba(255, 215, 0, 0.2)',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.04)',
              color: '#e0e0e0',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease',
              fontSize: '0.9rem',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
          >
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Export Hand History</div>
            <div style={{ fontSize: '0.78rem', color: '#8888AA' }}>Your recent hands (from your seat) as CSV</div>
          </button>

          <button
            onClick={exportSessionStats}
            style={{
              padding: '14px 20px',
              border: '1px solid rgba(255, 215, 0, 0.2)',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.04)',
              color: '#e0e0e0',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease',
              fontSize: '0.9rem',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
          >
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Export My Stats</div>
            <div style={{ fontSize: '0.78rem', color: '#8888AA' }}>Your server stats and recent chip counts as CSV</div>
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.75rem', color: '#555' }}>
          Files will download automatically to your default downloads folder.
        </div>
        {note && <div className="export-data-note">{note}</div>}
      </div>
    </div>,
    document.body
  );
}
