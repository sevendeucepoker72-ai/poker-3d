// No red on the broadcast (owner rule: blue + gold, amber / slate for
// warnings; red only on card suits, which Card2D colours from cardUtils and
// never from these files). Every colour literal written in src/broadcast/**
// (CSS, JS, JSX — comments stripped) and broadcast.html is parsed; any hue in
// the red band (isRedHue: 340-360 / 0-20 degrees) with real saturation fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRedHue } from '../../src/utils/noRedHue.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'src/broadcast');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' ? [] : walk(p);
    return /\.(css|js|jsx)$/.test(e.name) ? [p] : [];
  });
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

const NAMED_REDS = ['red', 'darkred', 'crimson', 'firebrick', 'indianred', 'maroon', 'tomato', 'orangered', 'salmon', 'darksalmon', 'lightsalmon', 'lightcoral', 'coral', 'hotpink', 'deeppink', 'palevioletred', 'mediumvioletred'];

/** Every colour literal in a source text: [{text, hsl}] (hsl null for named reds). */
export function colorsIn(src) {
  const out = [];
  for (const m of src.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    let hex = m[1];
    if (![3, 4, 6, 8].includes(hex.length)) continue;
    if (hex.length <= 4) hex = hex.slice(0, 3).split('').map((ch) => ch + ch).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    out.push({ text: m[0], hsl: rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255) });
  }
  for (const m of src.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/g)) {
    out.push({ text: m[0], hsl: rgbToHsl(+m[1], +m[2], +m[3]) });
  }
  for (const m of src.matchAll(/hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/g)) {
    out.push({ text: m[0], hsl: { h: +m[1], s: +m[2] / 100, l: +m[3] / 100 } });
  }
  const named = new RegExp(`(?:[:\\s,(]|['"\`])(${NAMED_REDS.join('|')})(?=[\\s;,)}!'"\`]|$)`, 'gim');
  for (const m of src.matchAll(named)) {
    // only in a colour position: a CSS declaration value or a quoted string
    const before = src.slice(Math.max(0, m.index - 60), m.index + 1);
    if (/(color|background|border|fill|stroke|shadow|outline)[\w-]*\s*:[^;{}]*$/i.test(before) || /['"`]$/.test(m[0].charAt(0))) {
      out.push({ text: m[1], hsl: null });
    }
  }
  return out;
}

export function isRedColor({ hsl }) {
  if (hsl === null) return true;
  return isRedHue(hsl.h) && hsl.s >= 0.3 && hsl.l >= 0.1 && hsl.l <= 0.95;
}

test('the colour parser itself: catches red, passes the brand palette', () => {
  const reds = colorsIn('a{color:#E63946;background:rgb(220, 38, 38);border-color:hsl(350, 80%, 50%);outline:1px solid red}');
  assert.equal(reds.length, 4);
  assert.ok(reds.every(isRedColor));
  const brand = colorsIn('a{color:#ffd24a;background:#f59e0b;border-color:#3b82f6;fill:#64748b;stroke:rgba(120,160,255,.3);x:#1a1300;y:#6b4a12}');
  assert.equal(brand.length, 7);
  assert.equal(brand.some(isRedColor), false);
  assert.equal(colorsIn(stripComments('// no red here, color: red\n/* outline: red */ a{}')).length, 0, 'comments are not colours');
  assert.equal(colorsIn("const c = 'red';").length, 1, 'a quoted named red is caught');
});

test('no red in any broadcast stylesheet or component', () => {
  const files = [...walk(DIR), path.join(ROOT, 'broadcast.html')];
  assert.ok(files.some((f) => f.endsWith('broadcast.css')));
  const hits = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const col of colorsIn(src)) {
      if (isRedColor(col)) hits.push(`${path.relative(ROOT, f)}: ${col.text}`);
    }
  }
  assert.deepEqual(hits, []);
});
