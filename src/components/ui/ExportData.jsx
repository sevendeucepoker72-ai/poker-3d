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

function exportHandHistory() {
  // Batch 5d: read the REAL hand history from the table store (hydrated from the
  // server's durableState), not the never-written sessionStorage key that made
  // this export always empty.
  let history = [];
  try { history = useTableStore.getState().handHistories || []; } catch { /* ignore */ }

  if (!Array.isArray(history) || history.length === 0) {
    alert('No hand history yet — play some hands first.');
    return;
  }

  // Build CSV
  const headers = ['Hand #', 'Date', 'Table', 'Position', 'Hole Cards', 'Board', 'Hand Rank', 'Pot', 'Result', 'Chips Won/Lost'];
  const rows = history.map((h, i) => [
    i + 1,
    h.timestamp ? new Date(h.timestamp).toLocaleString() : '',
    h.tableName || h.table || '',
    h.position || '',
    h.holeCards || '',
    h.board || '',
    h.handRank || h.rank || '',
    h.pot || '',
    h.result || (h.won ? 'Won' : 'Lost'),
    h.chipsWon || h.chipChange || '',
  ]);

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
