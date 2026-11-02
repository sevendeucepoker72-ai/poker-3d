/**
 * BroadcastErrorBoundary — a render error on air never leaves a blank or
 * broken frame (lead spec C1, 2026-11-02): it shows the slate at once and
 * remounts the scene after 5 s. The slate here (ShellSlate) depends on nothing
 * but this file and broadcast.css, so it draws even when a scene is the thing
 * that broke. Also the shell's own picture while the page connects.
 */
import { Component } from 'react';
import { LEGAL_LINE } from '../model/contract.js';

const REMOUNT_AFTER_MS = 5000;

export function ShellSlate({ title = "We'll be right back", sub = '', legal = LEGAL_LINE, reason = '' }) {
  return (
    <div className="bc-shell-slate" data-reason={reason || undefined}>
      <div className="bc-shell-slate__brand">American Pub Poker</div>
      <div className="bc-shell-slate__title">{title}</div>
      {sub ? <div className="bc-shell-slate__sub">{sub}</div> : null}
      {legal ? <div className="bc-shell-slate__legal">{legal}</div> : null}
    </div>
  );
}

export default class BroadcastErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, generation: 0 };
    this.timer = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[broadcast] render error — slate for 5 s, then remount', error && error.message, info && info.componentStack);
    if (typeof this.props.onError === 'function') {
      try { this.props.onError(error); } catch { /* never rethrow from the boundary */ }
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setState((s) => ({ error: null, generation: s.generation + 1 }));
    }, REMOUNT_AFTER_MS);
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    if (this.state.error) return <ShellSlate reason="render_error" legal={this.props.legal} />;
    return <div className="bc-scene-box" key={this.state.generation}>{this.props.children}</div>;
  }
}
