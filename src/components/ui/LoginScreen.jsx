import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { getSocket } from '../../services/socketService';
import './LoginScreen.css';

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,20}$/;

function EyeIcon({ open }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function StrengthMeter({ password }) {
  const score = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(s, 4);
  })();
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', '#EF4444', '#F59E0B', '#3B82F6', '#4ADE80'];
  if (!password) return null;
  return (
    <div className="login-strength">
      <div className="login-strength-bars">
        {[1,2,3,4].map(i => (
          <div key={i} className="login-strength-bar" style={{ background: i <= score ? colors[score] : 'rgba(255,255,255,0.08)' }} />
        ))}
      </div>
      <span className="login-strength-label" style={{ color: colors[score] }}>{labels[score]}</span>
    </div>
  );
}

function LockoutBanner({ secs }) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const display = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  return (
    <div className="login-lockout-banner">
      <span className="login-lockout-icon">🔒</span>
      Too many failed attempts. Try again in <strong>{display}</strong>
    </div>
  );
}

export default function LoginScreen() {
  const [mode, setMode] = useState('login');
  const [flipping, setFlipping] = useState(false);
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem('poker_remember_phone') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    try { return !!localStorage.getItem('poker_remember_phone'); } catch { return false; }
  });
  const [keepSignedIn, setKeepSignedIn] = useState(() => {
    try { return localStorage.getItem('poker_keep_signed_in') === '1'; } catch { return false; }
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ username: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [lockoutSecs, setLockoutSecs] = useState(0);
  const [usernameAvail, setUsernameAvail] = useState(null); // null | true | false
  const checkTimerRef = useRef(null);
  const passwordRef = useRef(null);

  const login = useGameStore((s) => s.login);
  const tables = useTableStore((s) => s.tables);
  const totalOnline = tables.reduce((sum, t) => sum + (t.playerCount || 0), 0);

  // Lockout countdown
  useEffect(() => {
    if (lockoutSecs <= 0) return;
    const t = setInterval(() => setLockoutSecs(s => {
      if (s <= 1) { clearInterval(t); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [lockoutSecs]);

  // Refs so socket handlers always see latest values without re-registering listeners
  const stateRef = useRef({});
  stateRef.current = { username, rememberMe, keepSignedIn, login };

  // Socket listeners — registered once, use stateRef for fresh values
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleLoginResult = (result) => {
      const { username: uname, rememberMe: rm, keepSignedIn: ksi, login: doLogin } = stateRef.current;
      setLoading(false);
      if (result.success) {
        if (rm) {
          localStorage.setItem('poker_remember_phone', uname.trim());
        } else {
          localStorage.removeItem('poker_remember_phone');
        }
        if (ksi) {
          localStorage.setItem('poker_keep_signed_in', '1');
          localStorage.setItem('poker_auth_token', result.token);
          sessionStorage.removeItem('poker_auth_token');
        } else {
          localStorage.removeItem('poker_keep_signed_in');
          localStorage.removeItem('poker_auth_token');
          sessionStorage.setItem('poker_auth_token', result.token);
        }
        localStorage.setItem('poker_username', result.userData.username);
        doLogin(result.userData, result.token);
      } else {
        // Handle lockout
        if (result.lockoutSecs) {
          setLockoutSecs(result.lockoutSecs);
          setError('');
        } else {
          setError(result.error || 'Login failed');
        }
        // Clear password and focus it on failure
        setPassword('');
        setTimeout(() => passwordRef.current?.focus(), 50);
      }
    };

    const handleRegisterResult = (result) => {
      const { keepSignedIn: ksi, login: doLogin } = stateRef.current;
      setLoading(false);
      if (result.success) {
        if (ksi) {
          localStorage.setItem('poker_keep_signed_in', '1');
          localStorage.setItem('poker_auth_token', result.token);
          sessionStorage.removeItem('poker_auth_token');
        } else {
          localStorage.removeItem('poker_keep_signed_in');
          localStorage.removeItem('poker_auth_token');
          sessionStorage.setItem('poker_auth_token', result.token);
        }
        localStorage.setItem('poker_username', result.userData.username);
        doLogin(result.userData, result.token);
      } else {
        setError(result.error || 'Registration failed');
      }
    };

    const handleCheckUsername = (result) => {
      const { username: uname } = stateRef.current;
      if (result.username === uname.trim()) setUsernameAvail(result.available);
    };

    socket.on('loginResult', handleLoginResult);
    socket.on('registerResult', handleRegisterResult);
    socket.on('checkUsernameResult', handleCheckUsername);
    return () => {
      socket.off('loginResult', handleLoginResult);
      socket.off('registerResult', handleRegisterResult);
      socket.off('checkUsernameResult', handleCheckUsername);
    };
  }, []);

  // Debounced username availability check (register mode only)
  const checkUsername = useCallback((val) => {
    clearTimeout(checkTimerRef.current);
    setUsernameAvail(null);
    if (mode !== 'register' || val.trim().length < 3) return;
    checkTimerRef.current = setTimeout(() => {
      const socket = getSocket();
      socket?.emit('checkUsername', { username: val.trim() });
    }, 500);
  }, [mode]);

  const handleUsernameChange = (e) => {
    setUsername(e.target.value);
    setFieldErrors(fe => ({ ...fe, username: '' }));
    checkUsername(e.target.value);
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    setFieldErrors(fe => ({ ...fe, password: '' }));
  };

  const handleConfirmChange = (e) => {
    setConfirmPassword(e.target.value);
    setFieldErrors(fe => ({ ...fe, confirmPassword: '' }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const fe = { username: '', password: '', confirmPassword: '' };

    if (lockoutSecs > 0) return;

    const socket = getSocket();
    if (!socket?.connected) { setError('Not connected to server. Please wait...'); return; }

    if (mode === 'login') {
      if (!username.trim()) { fe.username = 'Username is required'; }
      if (!password) { fe.password = 'Password is required'; }
      if (fe.username || fe.password) { setFieldErrors(fe); return; }
      setLoading(true);
      socket.emit('login', { phone: username.trim(), password });
    } else {
      const trimmedUser = username.trim();
      if (!USERNAME_REGEX.test(trimmedUser)) {
        fe.username = 'Username: 3-20 chars, letters/numbers/_ or -';
      }
      if (!password || password.length < 8) {
        fe.password = 'Password must be at least 8 characters';
      }
      if (!confirmPassword) {
        fe.confirmPassword = 'Please confirm your password';
      } else if (password !== confirmPassword) {
        fe.confirmPassword = 'Passwords do not match';
      }
      if (fe.username || fe.password || fe.confirmPassword) { setFieldErrors(fe); return; }
      setLoading(true);
      socket.emit('register', { username: trimmedUser, password });
    }
  };

  const handleGuestPlay = () => {
    const guestName = `Guest${Math.floor(Math.random() * 9000) + 1000}`;
    const socket = getSocket();
    if (!socket?.connected) { setError('Not connected to server. Please wait...'); return; }
    setLoading(true);
    socket.emit('register', { username: guestName, password: `guest_${Date.now()}_Xk9` });
  };

  const toggleMode = () => {
    setFlipping(true);
    setTimeout(() => {
      setMode(m => m === 'login' ? 'register' : 'login');
      setError('');
      setFieldErrors({ username: '', password: '', confirmPassword: '' });
      setConfirmPassword('');
      setUsernameAvail(null);
      setLockoutSecs(0);
      setFlipping(false);
    }, 220);
  };

  const availIcon = usernameAvail === true ? '✓' : usernameAvail === false ? '✗' : '';
  const availColor = usernameAvail === true ? '#4ADE80' : '#EF4444';

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

      {/* Flip card wrapper */}
      <div className={`login-flip-wrap ${flipping ? 'login-flip-wrap--flipping' : ''}`}>
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
            <p className="login-subtitle">
              {mode === 'login' ? 'Welcome back to the table' : 'Create your account'}
            </p>
          </div>

          {/* Form */}
          <form className="login-form" onSubmit={handleSubmit}>
            {/* Username */}
            <div className="login-field">
              <label className="login-label">Username</label>
              <div className={`login-input-wrap${fieldErrors.username ? ' login-input-wrap--error' : ''}`}>
                <span className="login-field-icon">👤</span>
                <input
                  type="text"
                  className="login-input login-input--icon"
                  placeholder="Enter your username"
                  value={username}
                  onChange={handleUsernameChange}
                  maxLength={20}
                  autoFocus
                  autoComplete="username"
                />
                {mode === 'register' && availIcon && !fieldErrors.username && (
                  <span className="login-avail-icon" style={{ color: availColor }}>{availIcon}</span>
                )}
              </div>
              {fieldErrors.username && (
                <span className="login-field-hint login-field-hint--error">{fieldErrors.username}</span>
              )}
              {!fieldErrors.username && mode === 'register' && usernameAvail === false && (
                <span className="login-field-hint login-field-hint--error">Username already taken</span>
              )}
              {!fieldErrors.username && mode === 'register' && usernameAvail === true && (
                <span className="login-field-hint login-field-hint--ok">Username available!</span>
              )}
            </div>

            {/* Password */}
            <div className="login-field">
              <label className="login-label">Password</label>
              <div className={`login-input-wrap${fieldErrors.password ? ' login-input-wrap--error' : ''}`}>
                <span className="login-field-icon">🔒</span>
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  className="login-input login-input--icon login-input--eye"
                  placeholder="Enter your password"
                  value={password}
                  onChange={handlePasswordChange}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button type="button" className="login-eye-btn" onClick={() => setShowPassword(v => !v)}>
                  <EyeIcon open={showPassword} />
                </button>
              </div>
              {fieldErrors.password && (
                <span className="login-field-hint login-field-hint--error">{fieldErrors.password}</span>
              )}
              {mode === 'register' && <StrengthMeter password={password} />}
            </div>

            {/* Confirm password */}
            {mode === 'register' && (
              <div className="login-field">
                <label className="login-label">Confirm Password</label>
                <div className={`login-input-wrap${fieldErrors.confirmPassword ? ' login-input-wrap--error' : ''}`}>
                  <span className="login-field-icon">🔒</span>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    className="login-input login-input--icon login-input--eye"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={handleConfirmChange}
                    autoComplete="new-password"
                  />
                  <button type="button" className="login-eye-btn" onClick={() => setShowConfirm(v => !v)}>
                    <EyeIcon open={showConfirm} />
                  </button>
                </div>
                {fieldErrors.confirmPassword && (
                  <span className="login-field-hint login-field-hint--error">{fieldErrors.confirmPassword}</span>
                )}
              </div>
            )}

            {/* Remember me + Keep signed in (login only) */}
            {mode === 'login' && (
              <div className="login-remember-row">
                <label className="login-remember">
                  <input
                    type="checkbox"
                    className="login-remember-check"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span className="login-remember-label">Remember me</span>
                </label>
                <label className="login-remember">
                  <input
                    type="checkbox"
                    className="login-remember-check"
                    checked={keepSignedIn}
                    onChange={(e) => setKeepSignedIn(e.target.checked)}
                  />
                  <span className="login-remember-label">Keep me signed in</span>
                </label>
              </div>
            )}

            {lockoutSecs > 0 && <LockoutBanner secs={lockoutSecs} />}
            {error && !lockoutSecs && <div className="login-error">{error}</div>}

            <button type="submit" className="login-submit-btn" disabled={loading || lockoutSecs > 0}>
              {loading && <span className="login-spinner" />}
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            {/* Guest play */}
            <button type="button" className="login-guest-btn" onClick={handleGuestPlay} disabled={loading}>
              Play as Guest
            </button>

            {mode === 'login' && (
              <div className="login-forgot-row">
                <button type="button" className="login-forgot-link" tabIndex={-1} onClick={() => alert('Password reset is not available yet. Please contact support.')}>Forgot password?</button>
              </div>
            )}
          </form>

          {/* Toggle */}
          <div className="login-toggle">
            {mode === 'login' ? (
              <>{"Don't have an account? "}<button className="login-toggle-link" onClick={toggleMode} type="button">Register</button></>
            ) : (
              <>{'Already have an account? '}<button className="login-toggle-link" onClick={toggleMode} type="button">Sign In</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
