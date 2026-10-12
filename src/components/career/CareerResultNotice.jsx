// Career venue names (CareerMode.jsx's VENUES order; kept here so the lobby
// shows the result without loading the Career Mode chunk).
const VENUE_NAMES = ['Home Game', 'Local Casino', 'Vegas Strip', 'Monte Carlo', 'Macau', 'WSOP Main Event'];

/** Player-facing title + line for a careerGameComplete result. */
function careerResultText(result) {
  const venue = Number.isInteger(result?.venue) ? VENUE_NAMES[result.venue] : null;
  const stage = Number.isInteger(result?.stage) ? result.stage : null;
  const where = venue ? `${venue}${stage !== null ? (stage === 2 ? ' — boss stage' : ` — stage ${stage + 1}`) : ''}` : 'Career Mode';
  if (result?.won) return { title: 'Career stage cleared!', line: where };
  return { title: 'Career stage lost', line: `${where}. Try it again from Career Mode.` };
}

/**
 * R2 (2026-10-11 — APPUI-24): the result of a Career Mode stage, shown on the
 * LOBBY (careerGameComplete sends the player there; the old result overlay
 * lived only on the table screen and was never seen). Offers the way back to
 * Career Mode.
 */
export default function CareerResultNotice({ result, onClose, onOpenCareer }) {
  if (!result) return null;
  const { title, line } = careerResultText(result);
  const stars = Math.max(0, Math.min(3, Number(result.stars) || 0));
  return (
    <div className="career-result-notice-overlay" role="dialog" aria-modal="false" aria-label={title}
      style={{
        position: 'fixed', left: 0, right: 0, top: 'calc(env(safe-area-inset-top, 0px) + 72px)',
        zIndex: 3200, display: 'flex', justifyContent: 'center', padding: '0 12px', pointerEvents: 'none',
      }}>
      <div className="career-result-notice" style={{
        pointerEvents: 'auto', width: 'min(380px, 100%)', boxSizing: 'border-box',
        padding: '16px 18px', borderRadius: 16, textAlign: 'center',
        background: 'linear-gradient(135deg, #0c1d44, #081434)',
        border: `2px solid ${result.won ? '#ffd24a' : 'rgba(120,160,255,0.55)'}`,
        boxShadow: '0 12px 36px rgba(0,0,0,0.6)', color: '#eaf1ff',
      }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: result.won ? '#ffd24a' : '#cfe0ff' }}>{title}</div>
        {result.won && stars > 0 && (
          <div aria-label={`${stars} stars`} style={{ fontSize: '1.4rem', margin: '4px 0', color: '#ffd24a', letterSpacing: 4 }}>
            {'★'.repeat(stars)}<span style={{ color: '#2a3a5c' }}>{'★'.repeat(3 - stars)}</span>
          </div>
        )}
        <div style={{ fontSize: '0.88rem', color: '#9fb4d8', margin: '4px 0 12px', lineHeight: 1.4 }}>{line}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onOpenCareer} style={{
            flex: 1, minHeight: 44, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800,
            background: 'linear-gradient(135deg, #ffd24a, #e6b422)', color: '#0a1628',
          }}>Career Mode</button>
          <button onClick={onClose} style={{
            flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer', fontWeight: 700,
            background: 'transparent', color: '#cfe0ff', border: '1px solid rgba(120,160,255,0.5)',
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}
