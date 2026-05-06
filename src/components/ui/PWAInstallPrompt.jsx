import { useState, useEffect } from 'react';

/**
 * PWAInstallPrompt — Shows an "Add to Home Screen" banner
 * when the browser fires the beforeinstallprompt event.
 *
 * Mobile audit 2026-04-22:
 * - iOS branch no longer uses window.alert() to explain the Share-sheet
 *   flow. An in-app modal (.pwa-ios-sheet) renders instead, styled to
 *   match the rest of the app.
 * - iOS banner is gated behind a visit-count threshold (>= 2 visits)
 *   so a cold first-visit doesn't immediately get interrupted.
 *   Android/beforeinstallprompt is still shown on first fire because
 *   that event only dispatches once the browser has decided the site
 *   meets PWA criteria (it has its own implicit threshold).
 */

const VISIT_COUNT_KEY = 'pwa_visit_count';
const INSTALL_DISMISSED_KEY = 'pwa_install_dismissed';
const IOS_VISIT_THRESHOLD = 2;

function getAndBumpVisitCount() {
  try {
    const raw = localStorage.getItem(VISIT_COUNT_KEY);
    const cur = raw ? parseInt(raw, 10) : 0;
    const next = Number.isFinite(cur) ? cur + 1 : 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [showIOSSheet, setShowIOSSheet] = useState(false);

  // Bump visit count once per mount (fires on each fresh page-load).
  const [visitCount] = useState(() => getAndBumpVisitCount());

  useEffect(() => {
    const dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY);
    if (dismissed) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Also show on iOS (where beforeinstallprompt doesn't fire) — but
  // only after the user's 2nd visit so first-timers aren't interrupted.
  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY);
    if (isIOS && !isStandalone && !dismissed && visitCount >= IOS_VISIT_THRESHOLD) {
      const timer = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [visitCount]);

  function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        setDeferredPrompt(null);
        setVisible(false);
      });
    } else {
      // iOS: surface the in-app instructions sheet instead of alert().
      setShowIOSSheet(true);
    }
  }

  function handleDismiss() {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    setVisible(false);
    setShowIOSSheet(false);
  }

  function closeIOSSheet() {
    setShowIOSSheet(false);
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <>
      {visible && (
        <div className="pwa-install-banner">
          <span className="pwa-install-banner-icon">🃏</span>
          <div className="pwa-install-banner-text">
            <div className="pwa-install-banner-title">Install American Pub Poker</div>
            <div className="pwa-install-banner-sub">
              {isIOS ? 'Tap here for Home-Screen instructions' : 'Play offline · No app store needed'}
            </div>
          </div>
          <button
            className="pwa-install-banner-btn"
            onClick={handleInstall}
          >
            Install
          </button>
          <button className="pwa-install-banner-dismiss" onClick={handleDismiss}>×</button>
        </div>
      )}

      {showIOSSheet && (
        <div
          className="pwa-ios-sheet-overlay"
          onClick={closeIOSSheet}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-ios-sheet-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="pwa-ios-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '360px',
              background: 'linear-gradient(180deg, #1a1a2e 0%, #12121e 100%)',
              border: '1px solid rgba(0, 217, 255, 0.35)',
              borderRadius: '16px',
              padding: '24px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
              color: '#e2e2f0',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.5)',
              fontFamily: 'inherit',
            }}
          >
            <div
              id="pwa-ios-sheet-title"
              style={{
                fontSize: '1.15rem',
                fontWeight: 800,
                textAlign: 'center',
                marginBottom: '16px',
                color: '#FDE68A',
              }}
            >
              Add to Home Screen
            </div>

            {/* iOS share glyph — square with upward arrow */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00D9FF"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Outer box */}
                <path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
                {/* Upward arrow */}
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>

            <ol
              style={{
                listStyle: 'decimal',
                paddingLeft: '24px',
                margin: '0 0 20px 0',
                lineHeight: 1.6,
                fontSize: '0.95rem',
              }}
            >
              <li>Tap the <strong style={{ color: '#00D9FF' }}>Share</strong> button</li>
              <li>Scroll to <strong style={{ color: '#00D9FF' }}>Add to Home Screen</strong></li>
              <li>Tap <strong style={{ color: '#00D9FF' }}>Add</strong></li>
            </ol>

            <button
              type="button"
              onClick={closeIOSSheet}
              style={{
                width: '100%',
                minHeight: '48px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 217, 255, 0.4)',
                background: 'linear-gradient(180deg, rgba(0, 217, 255, 0.18), rgba(0, 119, 160, 0.18))',
                color: '#ffffff',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
