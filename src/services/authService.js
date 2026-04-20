// OAuth2 Authorization Code + PKCE flow for American Pub Poker SSO

const AUTH_SERVER = import.meta.env.VITE_AUTH_SERVER_URL || 'https://auth.americanpubpoker.online';
const CLIENT_ID = 'poker-3d';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const SCOPES = 'openid profile offline_access';

// --- PKCE helpers ---

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(digest);
}

// --- Auth flow ---

export async function startLogin() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  // Store for callback
  sessionStorage.setItem('oauth_code_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${AUTH_SERVER}/auth?${params}`;
}

export async function handleCallback(code, state) {
  const savedState = sessionStorage.getItem('oauth_state');
  if (state !== savedState) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const codeVerifier = sessionStorage.getItem('oauth_code_verifier');
  sessionStorage.removeItem('oauth_code_verifier');
  sessionStorage.removeItem('oauth_state');

  const response = await fetch(`${AUTH_SERVER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${errBody}`);
  }

  // { access_token, id_token, refresh_token, expires_in, token_type, scope }
  return response.json();
}

export async function refreshAccessToken(refreshToken) {
  const response = await fetch(`${AUTH_SERVER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  return response.json();
}

export function startLogout(idToken) {
  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: window.location.origin,
  });
  window.location.href = `${AUTH_SERVER}/session/end?${params}`;
}

export function isAuthCallback() {
  return window.location.pathname === '/auth/callback';
}

export function getCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
  };
}
