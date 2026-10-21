/**
 * TableErrorBoundary — .online fix round 1 (2026-10-11, AUTH-6 / R1 contract #3).
 *
 * Wraps the TABLE view (GameScene + GameHUD) only. A render error there — a bad
 * seat in one frame, a malformed payload — used to reach the root boundary and
 * replace the WHOLE app with the generic error screen for everyone at the
 * table. Now only the table view is replaced, by a small recovery card:
 *   - "Table display error — tap to reload table": asks the server for a fresh
 *     full state of this seat ('requestState') and re-mounts the table view.
 *     A failed lazy chunk can't be re-rendered (React.lazy keeps the rejection),
 *     so that case reloads the page instead.
 *   - "Lobby": goes to the lobby WITHOUT leaving the table (the lobby's
 *     "Return to Table" brings him back; a tournament seat stays his).
 * Reporting the error is done centrally (C2: createRoot onCaughtError); this
 * only logs a tag.
 */
import { Component, Fragment } from 'react';
import { getSocket } from '../../services/socketService';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { resyncPayloadOf } from '../../utils/tableFlows';

const CHUNK_LOAD_ERROR_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Loading (CSS )?chunk|ChunkLoadError/i;
const RESYNC_SETTLE_MS = 600;

export default class TableErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, epoch: 0, reloading: false };
    this.reloadTable = this.reloadTable.bind(this);
    this.goToLobby = this.goToLobby.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('table render error'), reloading: false };
  }

  componentDidCatch(error) {
    try {
      console.error('[table-error-boundary] the table view failed to render; the rest of the app stays up:', error && error.message ? error.message : error);
    } catch { /* ignore */ }
  }

  componentWillUnmount() {
    clearTimeout(this._resyncTimer);
  }

  reloadTable() {
    const err = this.state.error;
    const msg = String((err && (err.message || err.name)) || err || '');
    if (CHUNK_LOAD_ERROR_RE.test(msg)) {
      try { window.location.reload(); } catch { /* ignore */ }
      return;
    }
    // A fresh FULL frame of this socket's seat replaces whatever broke the view.
    // Gameplay audit F155 — naming the table on screen (and whether he sat
    // there): a newer server re-attaches a socket whose seat is gone as a
    // spectator, or closes a table that is gone, instead of answering nothing.
    try {
      const s = getSocket();
      if (s && s.connected) {
        s.emit('requestState', resyncPayloadOf(useTableStore.getState(), 'table') || {});
      }
    } catch { /* best-effort */ }
    try { console.warn('[table-error-boundary] reload table: requested a full state and re-mounting the table view'); } catch { /* ignore */ }
    this.setState({ reloading: true });
    clearTimeout(this._resyncTimer);
    this._resyncTimer = setTimeout(() => {
      this.setState((st) => ({ error: null, reloading: false, epoch: st.epoch + 1 }));
    }, RESYNC_SETTLE_MS);
  }

  goToLobby() {
    try { useGameStore.getState().setScreen('lobby'); } catch { /* ignore */ }
  }

  render() {
    if (!this.state.error) {
      // A new epoch re-mounts the table view (fresh component state).
      return <Fragment key={this.state.epoch}>{this.props.children}</Fragment>;
    }
    const { reloading } = this.state;
    return (
      <div
        className="table-error-fallback"
        role="alert"
        style={{
          position: 'absolute', inset: 0, zIndex: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
          background: 'radial-gradient(ellipse at center, #0c1a44 0%, #060c1f 70%)',
        }}
      >
        <div style={{
          maxWidth: 340, width: '100%', textAlign: 'center',
          background: 'rgba(8, 20, 52, 0.96)',
          border: '1px solid rgba(255, 210, 74, 0.55)',
          borderRadius: 14, padding: '18px 16px 14px',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.55)',
          color: '#e2e8f0', fontFamily: 'inherit',
        }}>
          <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">♠</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 14, lineHeight: 1.4 }}>
            Your seat is safe. Only this screen failed to draw the table.
          </div>
          <button
            type="button"
            className="table-error-reload"
            onClick={this.reloadTable}
            disabled={reloading}
            style={{
              width: '100%', minHeight: 48, padding: '10px 14px',
              borderRadius: 10, border: '1px solid rgba(255, 210, 74, 0.8)',
              background: 'linear-gradient(135deg, #1e3a8a, #0d2c53)',
              color: '#ffd24a', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >
            {reloading ? 'Reloading table…' : 'Table display error — tap to reload table'}
          </button>
          <button
            type="button"
            className="table-error-lobby"
            onClick={this.goToLobby}
            style={{
              marginTop: 10, minHeight: 44, padding: '8px 18px',
              borderRadius: 10, border: '1px solid rgba(120, 160, 255, 0.35)',
              background: 'transparent', color: '#93c5fd', fontSize: 13, cursor: 'pointer',
            }}
          >
            Lobby (your seat is kept)
          </button>
        </div>
      </div>
    );
  }
}
