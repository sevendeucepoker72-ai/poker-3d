/**
 * Broadcast stage geometry (lead spec C1 Stage + C5 9:16, 2026-11-01). The page
 * draws on a FIXED logical canvas — 1920x1080 (16:9) or 1080x1920 (9:16) — and
 * scales it with one CSS transform to whatever size the OBS browser source is,
 * so a 1280x720 or 540x960 source shows the same picture.
 *
 * 9:16 safe zones: Reels / Shorts draw their own controls over the top ~12% and
 * the bottom ~20%; key information stays out of those bands (exact values are
 * UNCONFIRMED and get tuned in rehearsal — change them here only).
 */
export const STAGE_SIZES = Object.freeze({
  '16x9': Object.freeze({ w: 1920, h: 1080 }),
  '9x16': Object.freeze({ w: 1080, h: 1920 }),
});

export const SAFE_ZONE_9X16 = Object.freeze({ topPct: 12, bottomPct: 20 });

/** The logical canvas for a layout (unknown layout = 16:9). */
export function stageSize(layout) {
  return STAGE_SIZES[layout] || STAGE_SIZES['16x9'];
}

/**
 * Scale and offset that fit the canvas inside a `vw` x `vh` viewport, centred
 * (letterboxed). A missing / zero viewport gives scale 1 at the origin.
 */
export function fitStage(layout, vw, vh) {
  const { w, h } = stageSize(layout);
  if (!(vw > 0) || !(vh > 0)) return { w, h, scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(vw / w, vh / h);
  return {
    w,
    h,
    scale,
    offsetX: Math.round((vw - w * scale) / 2),
    offsetY: Math.round((vh - h * scale) / 2),
  };
}

/**
 * The band (logical px) a layout keeps clear of platform controls:
 * {top, bottom, left, right}. 16:9 has none.
 */
export function safeZone(layout) {
  const { w, h } = stageSize(layout);
  if (layout !== '9x16') return { top: 0, bottom: 0, left: 0, right: 0, w, h };
  return {
    top: Math.round((h * SAFE_ZONE_9X16.topPct) / 100),
    bottom: Math.round((h * SAFE_ZONE_9X16.bottomPct) / 100),
    left: 0,
    right: 0,
    w,
    h,
  };
}

/** True when a box {x, y, w, h} (logical px) stays out of the layout's unsafe bands. */
export function boxInSafeZone(layout, box) {
  const z = safeZone(layout);
  return box.y >= z.top && box.y + box.h <= z.h - z.bottom && box.x >= z.left && box.x + box.w <= z.w - z.right;
}
