/**
 * Brand hue guard (2026-10-11, .online R3 — K1-7 / K2-4 / K3-8 / APPUI-P3-7).
 *
 * Owner rule: blue + gold, no red anywhere in the UI (red only on card suits).
 * Name / seat colours computed as `hsl(hue, …)` from a hash used to land on
 * red / rose for about one player in nine. `noRedHue` moves a hue in the red
 * band ([340, 360) and [0, 20)) half-way round the wheel (cyan / blue); every
 * other hue is returned unchanged, so most players keep their colour.
 *
 * `span` covers a gradient that also paints `hue + span` (e.g. an avatar
 * running from hue to hue + 40): the hue moves when EITHER end would be red.
 */

/** True for a hue (degrees) the brand never shows. */
export function isRedHue(hue) {
  const h = ((hue % 360) + 360) % 360;
  return h < 20 || h >= 340;
}

/** `hue` (0-359), moved by 180 degrees when it — or `hue + span` — is red. */
export function noRedHue(hue, span = 0) {
  const h = ((Math.round(Number(hue) || 0) % 360) + 360) % 360;
  return isRedHue(h) || isRedHue(h + span) ? (h + 180) % 360 : h;
}
