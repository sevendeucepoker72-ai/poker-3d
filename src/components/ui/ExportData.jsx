import { createPortal } from 'react-dom';

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
  const historyRaw = sessionStorage.getItem('poker_hand_history');
  let history = [];
  try {
    history = JSON.parse(historyRaw || '[]');
  } catch { /* ignore */ }

  if (history.length === 0) {
    // Try alternative key formats
    const keys = Object.keys(sessionStorage).filter((k) => k.includes('hand') || k.includes('history'));
    for (const key of keys) {
      try {
        const data = JSON.parse(sessionStorage.getItem(key) || '[]');
        if (Array.isArray(data) && data.length > 0) {
          history = data;
          break;
        }
      } catch { /* ignore */ }
    }
  }

  if (history.length === 0) {
    alert('No hand history data found.');
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
  // Gather from sessionStorage
  const bankrollHistory = JSON.parse(sessionStorage.getItem('poker_bankroll_history') || '[]');
  const playerStats = JSON.parse(sessionStorage.getItem('poker_player_stats') || '{}');

  const lines = [];

  // Session summary
  lines.push(['Session Stats Export']);
  lines.push(['Generated', new Date().toLocaleString()]);
  lines.push([]);

  // Player stats
  lines.push(['Stat', 'Value']);
  for (const [key, value] of Object.entries(playerStats)) {
    lines.push([key, String(value)]);
  }
  lines.push([]);

  // Bankroll history
  lines.push(['Bankroll History']);
  lines.push(['Timestamp', 'Chips']);
  for (const point of bankrollHistory) {
    lines.push([
      new Date(point.timestamp).toLocaleString(),
      String(point.chips),
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
