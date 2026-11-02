/**
 * Stage — the broadcast page's fixed logical canvas (1920x1080 for 16:9,
 * 1080x1920 for 9:16), scaled with one CSS transform to fit the OBS browser
 * source (lead spec C1 / C5, 2026-11-02). Any source size shows the same
 * picture; the recommended source size is exact (scale 1).
 *
 * fit='window' (the page) follows the window size; fit='parent' fills the
 * parent element (the producer panel's program monitor), or pass `scale`.
 * The 9:16 safe-zone bands are exposed as --bc-safe-top / --bc-safe-bottom.
 */
import { useEffect, useRef, useState } from 'react';
import { fitStage, safeZone } from '../model/layoutFit.js';

function windowSize() {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export default function Stage({
  layout = '16x9',
  bg = 'opaque',
  motion = 'full',
  fit = 'window',
  scale = null,
  stale = false,
  className = '',
  children,
}) {
  const viewportRef = useRef(null);
  const [box, setBox] = useState(() => (fit === 'window' ? windowSize() : { w: 0, h: 0 }));

  useEffect(() => {
    if (fit === 'window') {
      const onResize = () => setBox(windowSize());
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0] && entries[0].contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const f = fitStage(layout, box.w, box.h);
  const s = Number.isFinite(scale) && scale > 0 ? scale : f.scale;
  const offsetX = Number.isFinite(scale) && scale > 0 ? 0 : f.offsetX;
  const offsetY = Number.isFinite(scale) && scale > 0 ? 0 : f.offsetY;
  const zone = safeZone(layout);

  const stageClass = [
    'bc-stage',
    layout === '9x16' ? 'bc-layout-9x16' : 'bc-layout-16x9',
    bg === 'transparent' ? 'bc-bg-transparent' : 'bc-bg-opaque',
    motion === 'reduced' ? 'bc-motion-reduced' : '',
    stale ? 'bc-stale' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={viewportRef}
      className={`bc-viewport ${bg === 'transparent' ? 'bc-viewport--transparent' : 'bc-viewport--opaque'}`}
    >
      <div
        className={stageClass}
        data-layout={layout}
        style={{
          width: `${f.w}px`,
          height: `${f.h}px`,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${s})`,
          '--bc-safe-top': `${zone.top}px`,
          '--bc-safe-bottom': `${zone.bottom}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
