import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { getSocket } from '../../services/socketService';
import { startLogin } from '../../services/authService';
import './LoginScreen.css';

// Generate a cryptographically-random password for guest accounts. The previous
// scheme (`guest_${Date.now()}_Xk9`) had only millisecond entropy and a static
// suffix — two guests registered in the same tick could collide.
function randomGuestPassword() {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'guest_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Ultra-old browser fallback — still not a secret that leaves the device
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // "Remember me" — previously set silently to 1 by the SSO path; now the
  // user controls it. Defaults ON (matches previous behavior for returning
  // users) but SSO + guest now both honor the checkbox.
  const [rememberMe, setRememberMe] = useState(() => {
    try { return sessionStorage.getItem('poker_keep_signed_in') !== '0'; }
    catch { return true; }
  });

  const login = useGameStore((s) => s.login);
  const tables = useTableStore((s) => s.tables);
  const totalOnline = tables.reduce((sum, t) => sum + (t.playerCount || 0), 0);

  // Listen for guest register result
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleRegisterResult = (result) => {
      setLoading(false);
      if (result.success) {
        if (rememberMe) {
          sessionStorage.setItem('poker_auth_token', result.token);
          sessionStorage.setItem('poker_keep_signed_in', '1');
        } else {
          sessionStorage.setItem('poker_auth_token', result.token);
          sessionStorage.setItem('poker_keep_signed_in', '0');
        }
        sessionStorage.setItem('poker_username', result.userData.username);
        login(result.userData, result.token);
      } else {
        setError(result.error || 'Guest login failed');
      }
    };

    socket.on('registerResult', handleRegisterResult);
    return () => socket.off('registerResult', handleRegisterResult);
  }, [login, rememberMe]);

  const handleSSOLogin = () => {
    try {
      sessionStorage.setItem('poker_keep_signed_in', rememberMe ? '1' : '0');
    } catch { /* ignore */ }
    setLoading(true);
    startLogin();
  };

  const handleGuestPlay = () => {
    const guestName = `Guest${Math.floor(Math.random() * 9000) + 1000}`;
    const socket = getSocket();
    if (!socket?.connected) {
      setError('Not connected to server. Please wait...');
      return;
    }
    setLoading(true);
    socket.emit('register', { username: guestName, password: randomGuestPassword() });
  };

  return (
    <div className="login-screen">
      {/* Background floating suits */}
      <div className="login-bg-cards">
        {['♠','♥','♦','♣','♠','♥','♦','♣'].map((s, i) => (
          <span key={i} className="login-bg-card">{s}</span>
        ))}
      </div>

      {/* Glow orbs */}
      <div className="login-glow-orb" />
      <div className="login-glow-orb" />

      {/* Social proof strip */}
      {totalOnline > 0 && (
        <div className="login-social-proof">
          <span className="login-social-dot" />
          {totalOnline.toLocaleString()} players online · {tables.length} tables running
        </div>
      )}

      {/* Card wrapper */}
      <div className="login-flip-wrap">
        <div className="login-card">
          {/* Corner suits */}
          <span className="login-corner-suit top-left">♠</span>
          <span className="login-corner-suit top-right">♥</span>
          <span className="login-corner-suit bottom-left">♦</span>
          <span className="login-corner-suit bottom-right">♣</span>

          {/* Branding */}
          <div className="login-branding">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="American Pub Poker"
              className="login-logo-img"
            />
            <h1 className="login-title">American Pub Poker</h1>
            <p className="login-subtitle">Welcome to the table</p>
          </div>

          {/* SSO Login */}
          <div className="login-form">
            {error && <div className="login-error">{error}</div>}

            <button
              type="button"
              className="login-submit-btn"
              onClick={handleSSOLogin}
              disabled={loading}
            >
              {loading && <span className="login-spinner" />}
              Sign In with American Pub Poker
            </button>

            <div style={{
              textAlign: 'center',
              color: 'rgba(255,255,255,0.3)',
              fontSize: '12px',
              margin: '12px 0',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              or
            </div>

            {/* Guest play */}
            <button
              type="button"
              className="login-guest-btn"
              onClick={handleGuestPlay}
              disabled={loading}
            >
              Play as Guest
            </button>

            {/* Remember me */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 14,
              fontSize: 13, color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#B388FF' }}
              />
              Keep me signed in on this device
            </label>
          </div>

          {/* Info text */}
          <div className="login-toggle" style={{ fontSize: '12px', opacity: 0.5 }}>
            Sign in once to play across all American Pub Poker sites
          </div>
        </div>
      </div>
    </div>
  );
}
