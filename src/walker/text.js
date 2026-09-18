// @ts-check
/**
 * テキストノードの計測。
 * Range を 1 文字ずつ張って各グリフの矩形を実測し、行ごとにグリフ列（GID・ペン位置）を返す。
 * ブラウザのカーニング・letter-spacing・禁則・両端揃えの結果がそのまま位置に反映される。
 */

/**
 * @typedef {object} MeasuredLine
 * @property {import('../font/registry.js').RegisteredFont} font
 * @property {number} baseline  ベースライン y（ビューポート座標 px）
 * @property {number} top       行内グリフ矩形の上端
 * @property {number} bottom    行内グリフ矩形の下端
 * @property {import('./walk.js').Glyph[]} glyphs
 */

/**
 * @typedef {object} MeasureOptions
 * @property {import('../font/registry.js').FontRegistry} registry
 * @property {string[]} families
 * @property {string[]} fallback
 * @property {import('../font/registry.js').RegisteredFont} primary
 * @property {number} weight
 * @property {'normal'|'italic'} fstyle
 * @property {number} size  px
 * @property {'font'|'measure'|'auto'} textMeasure
 * @property {(w: import('../index.js').ConversionWarning) => void} warn
 * @property {Element} element
 */

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c, 0xa0, 0x3000, 0x2002, 0x2003, 0x2009, 0x200a, 0x202f, 0x205f]);

/**
 * @param {Text} node
 * @param {CSSStyleDeclaration} style
 * @param {MeasureOptions} o
 * @returns {MeasuredLine[]}
 */
export function measureText(node, style, o) {
  const doc = node.ownerDocument;
  const text = applyTextTransform(node.data, style.textTransform);
  const range = doc.createRange();
  const baselineOffset = probeBaseline(doc, style);

  /** @type {MeasuredLine[]} */
  const lines = [];
  /** @type {MeasuredLine|null} */
  let cur = null;
  let curTop = NaN;
  /** @type {Set<number>} */
  const warnedCps = new Set();

  for (let i = 0; i < text.length; ) {
    const cp = /** @type {number} */ (text.codePointAt(i));
    const len = cp > 0xffff ? 2 : 1;
    const end = i + len;

    range.setStart(node, i);
    range.setEnd(node, Math.min(end, node.data.length));
    const rect = pickRect(range.getClientRects());
    i = end;
    if (!rect) continue; // 折り畳まれた空白・改行

    const resolved = resolveGlyph(cp, o, warnedCps);
    if (!resolved) continue;
    const { font, gid, cpForUnicode } = resolved;

    const top = rect.top;
    if (!cur || cur.font !== font || Math.abs(top - curTop) > 0.5) {
      cur = { font, baseline: top + baselineOffset, top, bottom: rect.bottom, glyphs: [] };
      curTop = top;
      lines.push(cur);
    }
    cur.top = Math.min(cur.top, top);
    cur.bottom = Math.max(cur.bottom, rect.bottom);
    const advance = ((font.parsed.advances[gid] ?? 0) * o.size) / font.parsed.unitsPerEm;
    cur.glyphs.push({ gid, cp: cpForUnicode, x: rect.left, advance });
  }
  return lines;
}

/**
 * 1 文字分の矩形のうち幅を持つものを選ぶ。行末の折り返し位置では 2 つ返ることがある。
 * @param {DOMRectList} rects
 * @returns {DOMRect|null}
 */
function pickRect(rects) {
  /** @type {DOMRect|null} */
  let best = null;
  for (const r of rects) {
    if (r.width > 0.01 && (!best || r.width > best.width)) best = r;
  }
  return best;
}

/**
 * コードポイントに対応するフォントと GID を決める。
 * @param {number} cp
 * @param {MeasureOptions} o
 * @param {Set<number>} warnedCps
 * @returns {{font: import('../font/registry.js').RegisteredFont, gid: number, cpForUnicode: number}|null}
 */
function resolveGlyph(cp, o, warnedCps) {
  const tryFont = (/** @type {import('../font/registry.js').RegisteredFont|null} */ f, /** @type {number} */ c) => {
    const gid = f?.parsed.cmap.get(c);
    return f && gid ? { font: f, gid, cpForUnicode: cp } : null;
  };

  // 空白類: 主フォントの同じ文字 → U+0020 で代替（位置は実測値で補正されるので幅は問わない）
  if (WHITESPACE.has(cp)) {
    return tryFont(o.primary, cp) ?? tryFont(o.primary, 0x20) ?? tryFont(o.registry.anyWithGlyph(0x20, o.weight, o.fstyle), 0x20);
  }

  let hit = tryFont(o.primary, cp);
  if (hit) return hit;
  hit = tryFont(o.registry.match(o.families, o.weight, o.fstyle, cp), cp);
  if (hit) return hit;
  hit = tryFont(o.registry.match(o.fallback, o.weight, o.fstyle, cp), cp);
  if (hit) return hit;
  hit = tryFont(o.registry.anyWithGlyph(cp, o.weight, o.fstyle), cp);
  if (hit) return hit;

  if (!warnedCps.has(cp)) {
    warnedCps.add(cp);
    o.warn({
      code: 'missing-glyph',
      message: `No registered font has a glyph for U+${cp.toString(16).toUpperCase().padStart(4, '0')} "${String.fromCodePoint(cp)}"; substituted with U+25A1`,
      element: o.element,
      text: String.fromCodePoint(cp),
    });
  }
  // 豆腐（□）で代替。ToUnicode には元の文字を残す
  const sub = tryFont(o.primary, 0x25a1) ?? tryFont(o.registry.anyWithGlyph(0x25a1, o.weight, o.fstyle), 0x25a1);
  return sub ? { ...sub, cpForUnicode: cp } : null;
}

/**
 * @param {string} s
 * @param {string} transform  computed text-transform
 * @returns {string}
 */
function applyTextTransform(s, transform) {
  if (!transform || transform === 'none') return s;
  let out = s;
  if (transform.includes('uppercase')) out = s.toUpperCase();
  else if (transform.includes('lowercase')) out = s.toLowerCase();
  else if (transform.includes('capitalize')) out = s.replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase());
  // 長さが変わる変換（ß → SS など）は Range のオフセットと対応が取れないので諦める
  return out.length === s.length ? out : s;
}

/** @type {WeakMap<Document, Map<string, number>>} */
const probeCache = new WeakMap();

/**
 * この font 指定で描いたテキストの Range 矩形の上端から、ベースラインまでの距離（px）を実測する。
 * inline-block（vertical-align: baseline）の下端がベースライン位置に一致することを利用する。
 * @param {Document} doc
 * @param {CSSStyleDeclaration} style
 * @returns {number}
 */
function probeBaseline(doc, style) {
  const key = [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch, style.fontVariant, style.fontFeatureSettings].join('|');
  let cache = probeCache.get(doc);
  if (!cache) {
    cache = new Map();
    probeCache.set(doc, cache);
  }
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const probe = doc.createElement('div');
  probe.setAttribute('data-rhtp-probe', '');
  probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;line-height:normal;margin:0;padding:0;border:0;letter-spacing:0;text-indent:0;';
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  probe.style.fontStretch = style.fontStretch;
  probe.style.fontVariant = style.fontVariant;
  probe.style.fontFeatureSettings = style.fontFeatureSettings;
  const textNode = doc.createTextNode('Agあ');
  probe.appendChild(textNode);
  const mark = doc.createElement('span');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0;border:0;';
  probe.appendChild(mark);
  doc.body.appendChild(probe);

  const range = doc.createRange();
  range.selectNodeContents(textNode);
  const textRect = range.getBoundingClientRect();
  const markRect = mark.getBoundingClientRect();
  const offset = markRect.bottom - textRect.top;
  probe.remove();

  const result = Number.isFinite(offset) && offset > 0 ? offset : parseFloat(style.fontSize) * 0.8;
  cache.set(key, result);
  return result;
}
