import {
  useGuestCarryStore, acceptGuestCarryOver, postponeGuestCarryOver,
  askDeclineGuestCarryOver, cancelDeclineGuestCarryOver, confirmDeclineGuestCarryOver,
} from '../../services/guestCarryOver';
import { useLiveTableOverlayStore } from '../../store/liveTableOverlayStore';

/**
 * One-time offer to carry a retired guest account's chips + progress over to
 * the signed-in American Pub Poker account (2026-10-09, contract R2). Driven
 * entirely by services/guestCarryOver.js. Rendered by App.jsx on the LOBBY
 * screen only — never over a live table (the table / career screens don't
 * render it, and the multi-table overlay suppresses it while open). Nothing
 * is claimed without the "Yes" tap.
 *
 * "Not now" keeps the guest token for next time. Throwing it away takes the
 * smaller "Don't bring it over" link AND a confirmation — the token is the
 * only key to those chips, so a mis-tap beside "Yes" must never lose them.
 *
 * Blue + gold, never red (owner preference).
 */
export default function GuestCarryOverPrompt() {
  const phase = useGuestCarryStore((s) => s.phase);
  const offer = useGuestCarryStore((s) => s.offer);
  const message = useGuestCarryStore((s) => s.message);
  const retryable = useGuestCarryStore((s) => s.retryable);
  const liveTablesOpen = useLiveTableOverlayStore((s) => s.open);
  if (phase === 'idle' || liveTablesOpen > 0) return null;

  const chips = offer?.chips;
  const level = offer?.level;
  const details = [];
  if (chips != null) details.push(`${chips.toLocaleString()} chips`);
  if (level != null) details.push(`level ${level}`);
  const question = details.length
    ? `Bring over your guest progress? (${details.join(', ')})`
    : 'Bring over your guest progress?';
  const extras = [];
  if (offer?.achievements > 0) extras.push(`${offer.achievements} achievement${offer.achievements === 1 ? '' : 's'}`);
  if (offer?.stars > 0) extras.push(`${offer.stars.toLocaleString()} stars`);

  const primaryBtn = {
    padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg, #ffd24a, #e6b422)',
    color: '#0a1628', fontWeight: 700, fontSize: 14,
  };
  const secondaryBtn = {
    padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
    background: 'transparent', color: '#cfe0ff', fontSize: 14,
    border: '1px solid rgba(120,160,255,0.45)',
  };
  const linkBtn = {
    padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer',
    color: 'rgba(207,224,255,0.75)', fontSize: 12, textDecoration: 'underline',
  };

  const claiming = phase === 'claiming';
  const asking = phase === 'offer' || claiming;
  const confirmingDecline = phase === 'confirmDecline';

  let body;
  if (asking) {
    body = (
      <>
        <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 15, lineHeight: 1.4 }}>
          {question}
        </div>
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#cfe0ff', lineHeight: 1.45 }}>
          You played as a guest on this device before. Those chips and that progress can move to
          your American Pub Poker account — one time only.
          {extras.length > 0 && <> Includes {extras.join(' and ')}.</>}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <button
            type="button"
            className="guest-carry-yes"
            onClick={() => { acceptGuestCarryOver().catch(() => {}); }}
            disabled={claiming}
            style={{ ...primaryBtn, cursor: claiming ? 'default' : 'pointer', opacity: claiming ? 0.6 : 1 }}
          >
            {claiming ? 'Bringing it over…' : 'Yes'}
          </button>
          <button
            type="button"
            className="guest-carry-later"
            onClick={postponeGuestCarryOver}
            disabled={claiming}
            style={{ ...secondaryBtn, cursor: claiming ? 'default' : 'pointer', opacity: claiming ? 0.6 : 1 }}
          >
            Not now
          </button>
        </div>
        {!claiming && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="guest-carry-decline"
              onClick={askDeclineGuestCarryOver}
              style={linkBtn}
            >
              Don&apos;t bring it over
            </button>
          </div>
        )}
      </>
    );
  } else if (confirmingDecline) {
    body = (
      <>
        <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 15, lineHeight: 1.4 }}>
          Leave your guest progress behind?
        </div>
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#cfe0ff', lineHeight: 1.45 }}>
          {chips != null ? `The ${chips.toLocaleString()} chips` : 'The chips'} and progress from your guest
          session will stay behind, and you won&apos;t be asked again on this device.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" onClick={cancelDeclineGuestCarryOver} style={primaryBtn}>
            Go back
          </button>
          <button
            type="button"
            className="guest-carry-decline-confirm"
            onClick={confirmDeclineGuestCarryOver}
            style={secondaryBtn}
          >
            Yes, leave it behind
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 15, lineHeight: 1.4 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          {phase === 'error' && retryable && (
            <button
              type="button"
              onClick={() => { acceptGuestCarryOver().catch(() => {}); }}
              style={primaryBtn}
            >
              Try again
            </button>
          )}
          <button type="button" onClick={postponeGuestCarryOver} style={secondaryBtn}>
            {phase === 'error' && retryable ? 'Not now' : 'OK'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className="guest-carry-prompt"
      role="dialog"
      aria-live="polite"
      aria-label="Bring over your guest progress"
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10045,
        width: 'min(92vw, 400px)',
        boxSizing: 'border-box',
        padding: '16px 18px',
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(12,28,72,0.98), rgba(8,18,48,0.98))',
        border: '1px solid rgba(255,210,74,0.55)',
        boxShadow: '0 10px 36px rgba(0,0,0,0.6)',
        color: '#e8eefc',
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      {body}
    </div>
  );
}
