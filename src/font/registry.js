// @ts-check
/**
 * 登録フォントの管理と CSS font-family / font-weight / font-style からのフォント選択。
 */
import { parseFont } from './parse.js';

/**
 * @typedef {object} RegisteredFont
 * @property {string} family      正規化済み（小文字・引用符なし）
 * @property {string} displayFamily
 * @property {number} weight
 * @property {'normal'|'italic'} style
 * @property {import('./parse.js').ParsedFont} parsed
 */

export class FontRegistry {
  constructor() {
    /** @type {RegisteredFont[]} */
    this.fonts = [];
  }

  /**
   * @param {import('../index.js').FontSource} source
   * @returns {Promise<RegisteredFont>}
   */
  async register(source) {
    const bytes = await loadBytes(source.src);
    const parsed = parseFont(bytes);
    const entry = {
      family: normalizeFamily(source.family),
      displayFamily: source.family,
      weight: source.weight ?? 400,
      style: source.style ?? 'normal',
      parsed,
    };
    const idx = this.fonts.findIndex(
      (f) => f.family === entry.family && f.weight === entry.weight && f.style === entry.style,
    );
    if (idx >= 0) this.fonts[idx] = entry;
    else this.fonts.push(entry);
    return entry;
  }

  /** @param {string} family */
  hasFamily(family) {
    const n = normalizeFamily(family);
    return this.fonts.some((f) => f.family === n);
  }

  /**
   * CSS の指定に最も近い登録フォントを返す。
   * @param {string[]} families   font-family リスト（優先順）
   * @param {number} weight
   * @param {'normal'|'italic'} style
   * @param {number} [codePoint]  指定するとこの文字のグリフを持つフォントに限定する
   * @returns {RegisteredFont|null}
   */
  match(families, weight, style, codePoint) {
    for (const fam of families) {
      const n = normalizeFamily(fam);
      let candidates = this.fonts.filter((f) => f.family === n);
      if (codePoint !== undefined) candidates = candidates.filter((f) => f.parsed.cmap.has(codePoint));
      if (!candidates.length) continue;
      return pickFace(candidates, weight, style);
    }
    return null;
  }

  /**
   * 登録済みの全ファミリーの中から、指定文字のグリフを持つものを探す（最終フォールバック）。
   * @param {number} codePoint
   * @param {number} weight
   * @param {'normal'|'italic'} style
   * @returns {RegisteredFont|null}
   */
  anyWithGlyph(codePoint, weight, style) {
    const candidates = this.fonts.filter((f) => f.parsed.cmap.has(codePoint));
    return candidates.length ? pickFace(candidates, weight, style) : null;
  }
}

/**
 * CSS Fonts Level 4 のフォントマッチングを簡略化したもの。
 * 1. style が一致するものを優先（なければ無視）
 * 2. weight: 400 は 500 を先に見る。400〜500 は上→下、<400 は下→上、>500 は上→下。
 * @param {RegisteredFont[]} candidates
 * @param {number} weight
 * @param {'normal'|'italic'} style
 * @returns {RegisteredFont}
 */
function pickFace(candidates, weight, style) {
  const styled = candidates.filter((f) => f.style === style);
  const pool = styled.length ? styled : candidates;
  const exact = pool.find((f) => f.weight === weight);
  if (exact) return exact;

  const sorted = [...pool].sort((a, b) => a.weight - b.weight);
  const heavier = sorted.filter((f) => f.weight > weight);
  const lighter = sorted.filter((f) => f.weight < weight).reverse();

  if (weight >= 400 && weight <= 500) {
    const mid = heavier.find((f) => f.weight <= 500);
    if (mid) return mid;
    if (lighter.length) return /** @type {RegisteredFont} */ (lighter[0]);
    return /** @type {RegisteredFont} */ (heavier[0]);
  }
  if (weight < 400) {
    return /** @type {RegisteredFont} */ (lighter[0] ?? heavier[0]);
  }
  return /** @type {RegisteredFont} */ (heavier[0] ?? lighter[0]);
}

/**
 * @param {string} family
 * @returns {string}
 */
export function normalizeFamily(family) {
  return family.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
}

/**
 * getComputedStyle().fontFamily（'"BIZ UDPGothic", sans-serif'）をリストに分割する。
 * @param {string} value
 * @returns {string[]}
 */
export function splitFamilies(value) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let quote = '';
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * getComputedStyle().fontWeight（'400' / '700' / 'bold'）を数値にする。
 * @param {string} value
 * @returns {number}
 */
export function parseWeight(value) {
  if (value === 'bold') return 700;
  if (value === 'normal') return 400;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 400;
}

/**
 * @param {string|ArrayBuffer|Uint8Array} src
 * @returns {Promise<Uint8Array>}
 */
async function loadBytes(src) {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to fetch font ${src}: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}
