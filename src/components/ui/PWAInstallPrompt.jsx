import { useState, useEffect } from 'react';

/**
 * PWAInstallPrompt — Shows an "Add to Home Screen" banner
 * when the browser fires the beforeinstallprompt event.
 */
export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('pwa_install_dismissed');
    if (dismissed) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Also show on iOS (where beforeinstallprompt doesn't fire)
  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = sessionStorage.getItem('pwa_install_dismissed');
    if (isIOS && !isStandalone && !dismissed) {
      const timer = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        setDeferredPrompt(null);
        setVisible(false);
      });
    } else {
      // iOS: show instructions
      alert('Tap the Share button (⬆) in Safari, then "Add to Home Screen"');
      setVisible(false);
    }
  }

  function handleDismiss() {
    sessionStorage.setItem('pwa_install_dismissed', '1');
    setVisible(false);
  }

  if (!visible) return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="pwa-install-banner">
      <span className="pwa-install-banner-icon">🃏</span>
      <div className="pwa-install-banner-text">
        <div className="pwa-install-banner-title">Install American Pub Poker</div>
        <div className="pwa-install-banner-sub">
          {isIOS ? 'Tap Share → Add to Home Screen' : 'Play offline · No app store needed'}
        </div>
      </div>
      {!isIOS && (
        <button className="pwa-install-banner-btn" onClick={handleInstall}>
          Install
        </button>
      )}
      <button className="pwa-install-banner-dismiss" onClick={handleDismiss}>×</button>
    </div>
  );
}
