import { useEffect } from 'react';
import { postSilentCallbackToParent } from '../../services/silentLogin';

/**
 * Silent OAuth callback handler — runs INSIDE the hidden iframe spawned
 * by trySilentLogin(). Reads code/state/error from the URL, postMessages
 * to the parent window, and renders nothing.
 *
 * Wired to /auth/silent-callback. KEEP separate from /auth/callback —
 * the user-facing callback is a top-level navigation that needs to do a
 * full token exchange + socket auth, while this page is just a cross-
 * frame messenger.
 */
export default function SilentCallback() {
  useEffect(() => {
    postSilentCallbackToParent();
  }, []);
  return null;
}
