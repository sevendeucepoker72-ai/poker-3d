import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import {
  QUALIFIER_RULES_TITLE, QUALIFIER_RULES_SUBTITLE, qualifierRulesFor, rulesUpdatedLine, rulesJumpRowWraps,
} from '../../content/qualifierRules';

// 2026-10-23 (owner) — the Weekly Qualifier Rules. The text lives in ONE data
// module (content/qualifierRules.js) so the owner's edits are one-file
// changes. Two ways in, never open at the same time: the "Rules" link on the
// weekly qualifier card (home card + Play tab) opens QualifierRules (a window
// of its own, Back closes it), and the qualifier's detail window
// (QualifierDashboard) shows QualifierRulesBody in its "Rules" tab.
// Blue + gold, never red; one column that fits a phone.
// Review fix-up: both are given the qualifier they were opened from, and
// qualifierRulesFor(qualifier) picks its lines (its seat package and bubble,
// and a rule that needs a server change only once the server says it does
// it). No rule words here: every one comes from the data module.

const GOLD = '#ffd24a';
const BLUE = '#6abaff';
const TEXT = '#cfe0ff';
const MUTED = '#8298c4';

function sectionDomId(prefix, i) {
  return `${prefix}-s${i}`;
}

/** The rules themselves (for this qualifier): the "updated" line and every section. */
export function QualifierRulesBody({ idPrefix, qualifier, sections: sectionsProp }) {
  const autoId = useId();
  const prefix = idPrefix || `qualifier-rules-${autoId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const own = useMemo(() => qualifierRulesFor(qualifier), [qualifier]);
  const sections = sectionsProp || own;
  const updated = rulesUpdatedLine();
  return (
    <div className="qualifier-rules-body" style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      {updated && (
        <div className="qualifier-rules-updated" style={{ color: MUTED, fontSize: '0.74rem' }}>{updated}</div>
      )}
      {sections.map((section, i) => (
        <section
          key={i}
          id={sectionDomId(prefix, i)}
          className="qualifier-rules-section"
          aria-labelledby={`${sectionDomId(prefix, i)}-h`}
          style={{ minWidth: 0 }}
        >
          <h3 id={`${sectionDomId(prefix, i)}-h`} style={{
            margin: '0 0 8px', color: GOLD, fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.02em',
            paddingBottom: 6, borderBottom: '1px solid rgba(255,210,74,0.22)',
          }}>
            {section.heading}
          </h3>
          {section.compact ? (
            <ul className="qualifier-rules-grid" style={{
              listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6,
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
            }}>
              {section.rules.map((rule, k) => (
                <li key={k} style={{
                  padding: '6px 10px', borderRadius: 8, fontSize: '0.8rem', color: TEXT, lineHeight: 1.4,
                  background: 'rgba(106,186,255,0.06)', border: '1px solid rgba(106,186,255,0.16)',
                  fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere',
                }}>{rule}</li>
              ))}
            </ul>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {section.rules.map((rule, k) => (
                <li key={k} style={{
                  position: 'relative', paddingLeft: 16, color: TEXT, fontSize: '0.86rem', lineHeight: 1.55,
                  overflowWrap: 'anywhere',
                }}>
                  <span aria-hidden="true" style={{
                    position: 'absolute', left: 2, top: '0.62em', width: 6, height: 6, borderRadius: '50%', background: GOLD,
                  }} />
                  {rule}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function readViewport() {
  return typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 0, h: 0 };
}

/** The viewport size, kept current (a phone turned sideways re-lays the header). */
function useViewport() {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    const on = () => setVp(readViewport());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return vp;
}

/** The rules in a window of their own (the qualifier card's "Rules" link), for the qualifier it was opened from. */
export default function QualifierRules({ onClose, qualifier }) {
  const autoId = useId();
  const prefix = `qualifier-rules-${autoId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const titleId = `${prefix}-title`;
  const closeRef = useRef(null);
  const overlayRef = useRef(null);
  const headerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const sections = useMemo(() => qualifierRulesFor(qualifier), [qualifier]);
  const vp = useViewport();

  // Hardware / browser Back closes the rules (not the page).
  useBackButtonClose(true, onClose);

  // Esc closes; the close button takes focus (keyboard / screen reader).
  useEffect(() => {
    try { closeRef.current?.focus({ preventScroll: true }); } catch { /* ignore */ }
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A heading tap scrolls its section to just under the sticky header
  // (whatever height the header has: the jump row wraps on a wide screen).
  const jumpTo = (i) => {
    try {
      const el = document.getElementById(sectionDomId(prefix, i));
      const box = overlayRef.current;
      if (!el || !box) return;
      const below = headerRef.current ? headerRef.current.getBoundingClientRect().bottom : box.getBoundingClientRect().top;
      const top = box.scrollTop + el.getBoundingClientRect().top - below - 10;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } catch { /* ignore */ }
  };
  // Phones, and any short screen (a phone held sideways): one row that
  // scrolls sideways, so the sticky header stays short; a screen both wide
  // and tall: the headings wrap, all in view (rulesJumpRowWraps). A short
  // screen also drops the subtitle line.
  const wrapJumpRow = rulesJumpRowWraps(vp.w, vp.h);
  const shortScreen = vp.h > 0 && vp.h < 500;

  return (
    <div
      ref={overlayRef}
      className="qualifier-rules-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(2,6,20,0.88)', zIndex: 1000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', boxSizing: 'border-box',
        padding: 'max(12px, env(safe-area-inset-top, 0px)) 12px max(12px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        className="qualifier-rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, minWidth: 0, boxSizing: 'border-box', background: '#0d1929',
          borderRadius: 16, border: '1px solid rgba(255,210,74,0.33)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Sticky header: the title, Close and a jump row stay in reach while he scrolls. */}
        <div ref={headerRef} style={{
          position: 'sticky', top: 0, zIndex: 1, background: '#0d1929', borderRadius: '16px 16px 0 0',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: shortScreen ? '6px 12px 2px 16px' : '14px 12px 8px 16px' }}>
            <span aria-hidden="true" style={{ fontSize: '1.6rem', lineHeight: 1 }}>📋</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id={titleId} style={{ margin: 0, color: '#fff', fontSize: '1.12rem', fontWeight: 800 }}>{QUALIFIER_RULES_TITLE}</h2>
              {!shortScreen && <div style={{ color: BLUE, fontSize: '0.74rem', marginTop: 3 }}>{QUALIFIER_RULES_SUBTITLE}</div>}
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close the rules"
              style={{ background: 'transparent', border: 'none', color: '#9fb4d8', fontSize: '1.4rem', cursor: 'pointer', padding: '0 6px', minWidth: 44, minHeight: 44 }}
            >✕</button>
          </div>
          <nav aria-label="Rule sections" className="qualifier-rules-jump" style={{
            display: 'flex', gap: 6, padding: '0 16px 10px',
            ...(wrapJumpRow ? { flexWrap: 'wrap' } : { overflowX: 'auto', WebkitOverflowScrolling: 'touch' }),
          }}>
            {sections.map((section, i) => (
              <button
                key={i}
                onClick={() => jumpTo(i)}
                style={{
                  flexShrink: 0, whiteSpace: 'nowrap', padding: '5px 11px', minHeight: 30, borderRadius: 16,
                  background: 'rgba(106,186,255,0.1)', border: '1px solid rgba(106,186,255,0.35)', color: TEXT,
                  fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                }}
              >{section.heading}</button>
            ))}
          </nav>
        </div>

        <div style={{ padding: '14px 16px 8px' }}>
          <QualifierRulesBody idPrefix={prefix} sections={sections} />
        </div>

        <div style={{ padding: '12px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 10 }}>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '12px 18px', borderRadius: 8, fontWeight: 800, fontSize: '0.9rem', border: 'none',
              background: 'linear-gradient(135deg,#ffd24a,#e6b422)', color: '#0a1628', cursor: 'pointer', minHeight: 44,
            }}
          >Close</button>
        </div>
      </div>
    </div>
  );
}
