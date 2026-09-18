// @ts-check
/**
 * 単位・色の変換ユーティリティ。
 * 内部座標は CSS px（ブラウザ計測値）で持ち、PDF 出力時に pt へ変換する。
 */

/** 1 CSS px = 0.75 pt（96dpi 基準） */
export const PX_TO_PT = 0.75;
/** 1 mm = 72 / 25.4 pt */
export const MM_TO_PT = 72 / 25.4;

/** @type {Record<string, {width: number, height: number}>} 用紙サイズ（pt） */
export const PAGE_SIZES = {
  A3: { width: 297 * MM_TO_PT, height: 420 * MM_TO_PT },
  A4: { width: 210 * MM_TO_PT, height: 297 * MM_TO_PT },
  A5: { width: 148 * MM_TO_PT, height: 210 * MM_TO_PT },
  B4: { width: 257 * MM_TO_PT, height: 364 * MM_TO_PT },
  B5: { width: 182 * MM_TO_PT, height: 257 * MM_TO_PT },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
};

/**
 * CSS 長さ文字列（'15mm', '1in', '12pt', '100px', '2cm'）を pt に変換する。
 * 単位なしの数値は px とみなす。
 * @param {string|number} value
 * @returns {number}
 */
export function lengthToPt(value) {
  if (typeof value === 'number') return value * PX_TO_PT;
  const m = /^\s*(-?[\d.]+)\s*([a-z%]*)\s*$/i.exec(value);
  if (!m) throw new Error(`Invalid CSS length: ${value}`);
  const n = parseFloat(/** @type {string} */ (m[1]));
  switch ((m[2] ?? '').toLowerCase()) {
    case '':
    case 'px':
      return n * PX_TO_PT;
    case 'pt':
      return n;
    case 'mm':
      return n * MM_TO_PT;
    case 'cm':
      return n * MM_TO_PT * 10;
    case 'in':
      return n * 72;
    case 'pc':
      return n * 12;
    default:
      throw new Error(`Unsupported CSS unit: ${value}`);
  }
}

/** @param {number} pt @returns {number} */
export function ptToPx(pt) {
  return pt / PX_TO_PT;
}

/**
 * getComputedStyle が返す px 文字列（'12px'）を数値にする。
 * @param {string} value
 * @returns {number}
 */
export function cssPx(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @typedef {{r: number, g: number, b: number, a: number}} Rgba  各成分 0〜1
 */

/**
 * getComputedStyle の色文字列（'rgb(34, 34, 34)' / 'rgba(0, 0, 0, 0.5)' / 'transparent'
 * / 'color(srgb ...)'）をパースする。パースできない場合は null。
 * @param {string} value
 * @returns {Rgba|null}
 */
export function parseColor(value) {
  if (!value) return null;
  const v = value.trim();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return {
      r: clamp01(parseFloat(/** @type {string} */ (m[1])) / 255),
      g: clamp01(parseFloat(/** @type {string} */ (m[2])) / 255),
      b: clamp01(parseFloat(/** @type {string} */ (m[3])) / 255),
      a: clamp01(a),
    };
  }
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return {
      r: clamp01(parseFloat(/** @type {string} */ (m[1]))),
      g: clamp01(parseFloat(/** @type {string} */ (m[2]))),
      b: clamp01(parseFloat(/** @type {string} */ (m[3]))),
      a: clamp01(a),
    };
  }
  m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = /** @type {string} */ (m[1]);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.padEnd(8, 'f'), 16);
    return { r: ((n >>> 24) & 255) / 255, g: ((n >>> 16) & 255) / 255, b: ((n >>> 8) & 255) / 255, a: (n & 255) / 255 };
  }
  return null;
}

/** @param {number} n */
function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * PDF 用に数値を丸めて文字列化する（小数第 3 位まで、末尾ゼロ除去）。
 * @param {number} n
 * @returns {string}
 */
export function num(n) {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(3);
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return t === '' || t === '-0' || t === '-' ? '0' : t;
}
