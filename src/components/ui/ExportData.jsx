import { createPortal } from 'react-dom';
import { useTableStore } from '../../store/tableStore';
import { useProgressStore } from '../../store/progressStore';

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

function cardsToStr(cards) {
  if (!Array.isArray(cards)) return '';
  return cards
    .map((c) => (c && (c.display || (c.rank != null && c.suit != null ? `${c.rank}${c.suit}` : ''))) || '')
    .filter(Boolean)
    .join(' ');
}

function exportHandHistory() {
  // Read the REAL hand history from the table store (hydrated from the server).
  // Each record is a full multi-player HandHistoryRecord — the player's own
  // cards / seat / net result live inside players[], NOT at the top level, and
  // the board is `communityCards`. The previous flat field names (h.holeCards,
  // h.board, h.chipsWon…) never matched the record, so every column was blank.
  let history = [];
  let myName = '';
  let mySeat = -1;
  try { history = useTableStore.getState().handHistories || []; } catch { /* ignore */ }
  try { mySeat = useTableStore.getState().mySeat ?? -1; } catch { /* ignore */ }
  try {
    const p = useProgressStore.getState().progress || {};
    myName = p.playerName || p.displayName || p.name || '';
  } catch { /* ignore */ }

  if (!Array.isArray(history) || history.length === 0) {
    alert('No hand history yet — play some hands first.');
    return;
  }

  // Build CSV — one row per hand, from this player's perspective.
  const headers = ['Hand #', 'Seat', 'Hole Cards', 'Board', 'Hand Rank', 'Pot', 'Result', 'Net Chips'];
  const rows = history.map((h, i) => {
    const players = Array.isArray(h.players) ? h.players : [];
    // Prefer a name match; fall back to the current seat if names are absent.
    const me = (myName && players.find((p) => p && p.name === myName))
      || (mySeat >= 0 && players.find((p) => p && p.seatIndex === mySeat))
      || null;
    const board = cardsToStr(h.communityCards);
    const pot = Array.isArray(h.pots)
      ? h.pots.reduce((s, pt) => s + (pt?.amount || 0), 0)
      : (h.pot || 0);
    const winners = Array.isArray(h.winners) ? h.winners : [];
    const iWon = me ? winners.some((w) => w && w.seatIndex === me.seatIndex) : false;
    const net = me && typeof me.endChips === 'number' && typeof me.startChips === 'number'
      ? me.endChips - me.startChips
      : '';
    return [
      h.handNumber ?? (i + 1),
      me ? me.seatIndex + 1 : '',
      me ? cardsToStr(me.holeCards) : '',
      board,
      me ? (me.handName || '') : '',
      pot,
      me ? (iWon ? 'Won' : (me.folded ? 'Folded' : 'Lost')) : '',
      net,
    ];
  });

  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCSV(`poker_hand_history_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function exportSessionStats() {
  // Batch 5d: build from the REAL progress store (server-authoritative), not the
  // never-written sessionStorage keys.
  let p = {};
  try { p = useProgressStore.getState().progress || {}; } catch { /* ignore */ }
  const totalHands = p.totalHandsPlayed ?? p.totalHands ?? 0;
  const handsWon = p.handsWon ?? p.wins ?? 0;
  const playerStats = {
    Level: p.level ?? 1,
    Chips: p.chips ?? 0,
    Stars: p.stars ?? 0,
    XP: p.xp ?? 0,
    'Total Hands': totalHands,
    'Hands Won': handsWon,
    'Win Rate %': totalHands > 0 ? ((handsWon / totalHands) * 100).toFixed(1) : '0.0',
    'Biggest Pot': p.biggestPot ?? 0,
    'Best Streak': p.bestStreak ?? 0,
    ELO: p.elo ?? 500,
    'Daily Login Streak': p.dailyLoginStreak ?? p.loginStreak ?? 0,
  };
  // Bankroll history from the progress chipHistory (server-hydrated) if present.
  const bankrollHistory = Array.isArray(p.chipHistory) ? p.chipHistory : [];

  const lines = [];
  lines.push(['Session Stats Export']);
  lines.push(['Generated', new Date().toLocaleString()]);
  lines.push([]);
  lines.push(['Stat', 'Value']);
  for (const [key, value] of Object.entries(playerStats)) {
    lines.push([key, String(value)]);
  }
  lines.push([]);
  lines.push(['Bankroll History']);
  lines.push(['Timestamp', 'Chips']);
  for (const point of bankrollHistory) {
    lines.push([
      point.timestamp ? new Date(point.timestamp).toLocaleString() : (point.t ? new Date(point.t).toLocaleString() : ''),
      String(point.chips ?? point.c ?? point.balance ?? ''),
    ]);
  }

  const csv = lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCSV(`poker_session_stats_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

export default function ExportData({ onClose }) {
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
            <div style={{ fontSize: '0.78rem', color: '#8888AA' }}>Download all recorded hands as CSV</div>
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
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Export Session Stats</div>
            <div style={{ fontSize: '0.78rem', color: '#8888AA' }}>Download bankroll history and stats as CSV</div>
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.75rem', color: '#555' }}>
          Files will download automatically to your default downloads folder.
        </div>
      </div>
    </div>,
    document.body
  );
}
