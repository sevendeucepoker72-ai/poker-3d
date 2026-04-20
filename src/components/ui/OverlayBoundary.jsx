import { Component } from 'react';

/**
 * OverlayBoundary — Minimal error boundary for lazy-loaded game overlays
 * (HandReplayViewer, EquityCalculator, ProvablyFair, etc.).
 *
 * If a chunk fails to download or parse (bad network, stale SW cache, CORS),
 * the default React behavior is to re-throw up the tree and blank the page.
 * This boundary catches the error, logs it once, and renders a tiny dismissible
 * toast so the rest of the GameHUD keeps functioning.
 *
 * Usage:
 *   <OverlayBoundary name="Hand Replay" onClose={() => setShowReplay(false)}>
 *     <Suspense fallback={null}>
 *       <HandReplayViewer ... />
 *     </Suspense>
 *   </OverlayBoundary>
 *
 * Intentionally class-based — function components can't implement
 * componentDidCatch / getDerivedStateFromError.
 */
export default class OverlayBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
    this._logged = false;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error, info) {
    if (this._logged) return;
    this._logged = true;
    // eslint-disable-next-line no-console
    console.error(`[OverlayBoundary:${this.props.name || 'unknown'}]`, error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const name = this.props.name || 'This panel';
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9000,
          background: 'rgba(30,10,10,0.96)',
          border: '1px solid rgba(239,68,68,0.5)',
          borderRadius: 12,
          padding: '18px 22px',
          color: '#fecaca',
          maxWidth: 360,
          boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
          fontFamily: 'system-ui',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ Failed to load</div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: '#fee2e2' }}>
          {name} couldn't load. Your connection may have dropped briefly.
          Try again, or refresh the page.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {this.props.onClose && (
            <button
              type="button"
              onClick={() => { this.setState({ hasError: false }); this.props.onClose(); }}
              style={{
                padding: '6px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff', cursor: 'pointer', fontSize: 13,
              }}
            >
              Close
            </button>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 14px', borderRadius: 8,
              background: 'linear-gradient(135deg,#ef4444,#b91c1c)',
              border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }
}
