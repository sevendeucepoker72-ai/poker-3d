/**
 * The broadcast stylesheet, made safe to load INSIDE the player app (lead spec
 * C6, 2026-11-02). The producer panel's program monitor draws the same Stage
 * OBS gets, so it needs src/broadcast/broadcast.css — but that file also
 * styles the broadcast PAGE itself (`html, body { background: transparent;
 * overflow: hidden }`, `#bc-root`), which would wipe the app's sapphire
 * background the moment the panel's chunk loaded (a lazily loaded stylesheet
 * stays for the whole session). The panel imports the file with `?inline`
 * (Vite: the CSS as a string, never injected) and injects only what this
 * keeps:
 *   - rules whose every selector starts with a `.bc-` class (the broadcast
 *     classes; a selector list keeps only its `.bc-` parts),
 *   - `:root` blocks, reduced to their `--bc-*` custom properties,
 *   - `@keyframes` (all named bc-*), `@media` / `@supports` with what they
 *     keep inside.
 * Everything else (html, body, #bc-root, *, @import, @font-face) is dropped.
 * Pure string work, no DOM: node:test runs it on the real file.
 */

function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Index of the `}` that closes the `{` at `open` (or -1). */
function closeOf(css, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a selector list on top-level commas (not inside parentheses). */
function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of prelude) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A selector the app cannot be hit by: it starts with a `.bc-` class. */
export function isScopedSelector(sel) {
  return /^\.bc-[A-Za-z0-9_-]/.test(String(sel).trim());
}

function rootBlock(body) {
  const decls = body.split(';').map((d) => d.trim()).filter((d) => /^--bc-[A-Za-z0-9_-]*\s*:/.test(d));
  return decls.length ? `:root{${decls.join(';')};}` : '';
}

/** The scoped stylesheet (see the header). */
export function scopeBroadcastCss(css) {
  const src = stripComments(css);
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    const semi = src.indexOf(';', i);
    // A statement at-rule (`@import ...;`, `@charset ...;`) before the next block: drop it.
    if (semi !== -1 && (open === -1 || semi < open) && /^\s*@/.test(src.slice(i, semi))) {
      i = semi + 1;
      continue;
    }
    if (open === -1) break;
    const close = closeOf(src, open);
    if (close === -1) break;
    const prelude = src.slice(i, open).trim();
    const body = src.slice(open + 1, close);
    i = close + 1;
    if (!prelude) continue;
    if (/^@keyframes\s/i.test(prelude) || /^@-webkit-keyframes\s/i.test(prelude)) {
      out += `${prelude}{${body}}\n`;
    } else if (/^@(media|supports)\b/i.test(prelude)) {
      const inner = scopeBroadcastCss(body);
      if (inner.trim()) out += `${prelude}{\n${inner}}\n`;
    } else if (prelude.startsWith('@')) {
      // @font-face, @page, @layer ...: not used by the stage; never injected.
      continue;
    } else if (prelude === ':root') {
      out += `${rootBlock(body)}\n`;
    } else {
      const kept = splitSelectors(prelude).filter(isScopedSelector);
      if (kept.length) out += `${kept.join(', ')}{${body.trim()}}\n`;
    }
  }
  return out;
}
