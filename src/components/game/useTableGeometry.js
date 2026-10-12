import { useEffect } from 'react';

/**
 * R2 (TABLEUI-8 / TABLEUI-9, 2026-10-11) — the table screen's MEASURED
 * geometry, published as CSS custom properties on <html> so the layout layer
 * (TableLayout.css) and every fixed in-table panel position themselves from
 * the real action-bar height and the real felt rect. The old layout stacked
 * hard-coded `bottom: 270px / 286px / 242px / 100px / 72px` guesses from five
 * different files; each phone size / orientation broke a different one (hero
 * cards over the Raise button in landscape, board over the top seat, pods under
 * the bar, the hand-strength pill over the pot).
 *
 *   --hud-bar-h   distance from the action bar's TOP edge to the viewport bottom
 *   --hud-top-h   the top bar's BOTTOM edge (viewport y)
 *   --felt-l / --felt-t / --felt-w / --felt-h   the felt oval (viewport px)
 *   --hero-plate-h  the hero nameplate's height (the cards sit above it)
 *
 * `table-geometry` is set on <html> once the first measurement landed, so the
 * CSS can fall back to its old rules until then. Everything is removed when the
 * table screen unmounts.
 */
export const TABLE_GEOMETRY_VARS = ['--hud-bar-h', '--hud-top-h', '--felt-l', '--felt-t', '--felt-w', '--felt-h', '--hero-plate-h'];
export const TABLE_GEOMETRY_EVENT = 'poker:felt-measured';

export default function useTableGeometry() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    let raf = 0;
    let ro = null;
    const observed = new Set();
    // The bars' heights are held at their LARGEST for this viewport size: the
    // action bar is shorter between hands ("Starting next hand…") than on a
    // turn, and the table (sized from these) must not jump twice per hand.
    // A resize / rotation / keyboard starts over.
    let maxBar = 0;
    let maxTop = 0;
    const setVar = (k, v) => {
      const s = `${Math.round(v)}px`;
      if (root.style.getPropertyValue(k) !== s) root.style.setProperty(k, s);
    };
    const observe = (el) => {
      if (el && ro && !observed.has(el)) { ro.observe(el); observed.add(el); }
    };
    const measure = () => {
      raf = 0;
      const vh = window.innerHeight || root.clientHeight || 0;
      const bar = document.querySelector('.hud-bottom');
      const top = document.querySelector('.hud-top');
      const scene = document.querySelector('.table2d-scene');
      const felt = document.querySelector('.table2d-felt');
      [bar, top, scene, felt].forEach(observe);
      let any = false;
      if (bar) {
        const r = bar.getBoundingClientRect();
        if (r.height > 0) {
          maxBar = Math.max(maxBar, Math.max(0, vh - r.top));
          setVar('--hud-bar-h', maxBar);
          any = true;
        }
      }
      if (top) {
        const r = top.getBoundingClientRect();
        if (r.height > 0) {
          maxTop = Math.max(maxTop, Math.max(0, r.bottom));
          setVar('--hud-top-h', maxTop);
        }
      }
      if (felt) {
        const r = felt.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setVar('--felt-l', r.left); setVar('--felt-t', r.top);
          setVar('--felt-w', r.width); setVar('--felt-h', r.height);
        }
      }
      const plate = document.querySelector('.hud-nameplate-me');
      observe(plate);
      if (plate) {
        const r = plate.getBoundingClientRect();
        if (r.height > 0) setVar('--hero-plate-h', r.height);
      }
      if (any) root.classList.add('table-geometry');
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const viewportChanged = () => { maxBar = 0; maxTop = 0; schedule(); };
    if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(schedule);
    schedule();
    // The felt is drawn by a sibling (GameScene) that can mount after the HUD;
    // PokerTable2D announces each felt measurement, and a short retry ladder
    // covers anything else that lands late (fonts, lazy chunks).
    const retries = [120, 400, 1200].map((ms) => setTimeout(schedule, ms));
    window.addEventListener('resize', viewportChanged);
    window.addEventListener('orientationchange', viewportChanged);
    window.addEventListener(TABLE_GEOMETRY_EVENT, schedule);
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', viewportChanged);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      retries.forEach(clearTimeout);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', viewportChanged);
      window.removeEventListener('orientationchange', viewportChanged);
      window.removeEventListener(TABLE_GEOMETRY_EVENT, schedule);
      if (vv) vv.removeEventListener('resize', viewportChanged);
      TABLE_GEOMETRY_VARS.forEach((k) => root.style.removeProperty(k));
      root.classList.remove('table-geometry');
    };
  }, []);
}
