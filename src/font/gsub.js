// @ts-check
/**
 * GSUB（グリフ置換）の単一置換だけを読む。
 *
 * ブラウザが `font-variant-*` / `font-feature-settings` で有効にした機能を、
 * 同じ結果になるように gid → gid の置換として再現する。
 * 置換は埋め込み前に解決するので、PDF に GSUB テーブル自体は入らない。
 *
 * 対応するのは Lookup タイプ 1（単一置換、フォーマット 1 / 2）と、
 * それを包むタイプ 7（拡張）だけ。タイプ 4（合字）はグリフ数が変わるため、
 * 1 文字ずつ位置を実測する走査モデルでは扱えない。
 */

/**
 * @typedef {object} GsubTable
 * @property {Map<string, number[]>} features  機能タグ → Lookup 番号
 * @property {(index: number) => Map<number, number>|null} lookup  単一置換の Lookup を読む（対応外なら null）
 */

/**
 * GSUB を読む。無い・壊れている場合は null。
 * @param {import('./parse.js').ParsedFont} font
 * @returns {GsubTable|null}
 */
export function parseGsub(font) {
  const t = font.tables.get('GSUB');
  if (!t || t.length < 10) return null;
  const dv = new DataView(font.data.buffer, font.data.byteOffset, font.data.byteLength);
  const base = t.offset;
  try {
    const featureListOff = base + dv.getUint16(base + 6);
    const lookupListOff = base + dv.getUint16(base + 8);

    /** @type {Map<string, number[]>} */
    const features = new Map();
    const featureCount = dv.getUint16(featureListOff);
    for (let i = 0; i < featureCount; i++) {
      const rec = featureListOff + 2 + i * 6;
      const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
      const featureOff = featureListOff + dv.getUint16(rec + 4);
      const count = dv.getUint16(featureOff + 2);
      const list = features.get(tag) ?? [];
      for (let j = 0; j < count; j++) list.push(dv.getUint16(featureOff + 4 + j * 2));
      features.set(tag, list);
    }

    const lookupCount = dv.getUint16(lookupListOff);
    /** @type {Map<number, Map<number, number>|null>} */
    const cache = new Map();
    /** @param {number} index */
    const lookup = (index) => {
      if (cache.has(index)) return /** @type {Map<number, number>|null} */ (cache.get(index) ?? null);
      let result = null;
      if (index >= 0 && index < lookupCount) {
        const off = lookupListOff + dv.getUint16(lookupListOff + 2 + index * 2);
        result = readLookup(dv, off, dv.getUint16(off), dv.getUint16(off + 4), off + 6);
      }
      cache.set(index, result);
      return result;
    };

    return { features, lookup };
  } catch {
    return null; // 壊れた GSUB は無いものとして扱う
  }
}

/**
 * @param {DataView} dv
 * @param {number} lookupOff
 * @param {number} type
 * @param {number} subTableCount
 * @param {number} offsetsAt  サブテーブルオフセット配列の位置
 * @returns {Map<number, number>|null}
 */
function readLookup(dv, lookupOff, type, subTableCount, offsetsAt) {
  if (type !== 1 && type !== 7) return null;
  /** @type {Map<number, number>} */
  const map = new Map();
  for (let i = 0; i < subTableCount; i++) {
    let sub = lookupOff + dv.getUint16(offsetsAt + i * 2);
    if (type === 7) {
      // 拡張: 実体の型とオフセットを読み直す
      if (dv.getUint16(sub) !== 1) continue;
      if (dv.getUint16(sub + 2) !== 1) continue; // 単一置換以外は対象外
      sub += dv.getUint32(sub + 4);
    }
    readSingleSubst(dv, sub, map);
  }
  return map.size ? map : null;
}

/**
 * SingleSubst（フォーマット 1 / 2）を map に読み込む。
 * @param {DataView} dv
 * @param {number} off
 * @param {Map<number, number>} map
 */
function readSingleSubst(dv, off, map) {
  const format = dv.getUint16(off);
  const coverage = readCoverage(dv, off + dv.getUint16(off + 2));
  if (format === 1) {
    const delta = dv.getInt16(off + 4);
    for (const gid of coverage) map.set(gid, (gid + delta) & 0xffff);
  } else if (format === 2) {
    const count = dv.getUint16(off + 4);
    for (let i = 0; i < coverage.length && i < count; i++) {
      map.set(/** @type {number} */ (coverage[i]), dv.getUint16(off + 6 + i * 2));
    }
  }
}

/**
 * Coverage テーブルを、カバレッジ番号順のグリフ配列として読む。
 * @param {DataView} dv
 * @param {number} off
 * @returns {number[]}
 */
function readCoverage(dv, off) {
  const format = dv.getUint16(off);
  /** @type {number[]} */
  const out = [];
  if (format === 1) {
    const count = dv.getUint16(off + 2);
    for (let i = 0; i < count; i++) out.push(dv.getUint16(off + 4 + i * 2));
  } else if (format === 2) {
    const count = dv.getUint16(off + 2);
    for (let i = 0; i < count; i++) {
      const rec = off + 4 + i * 6;
      const start = dv.getUint16(rec);
      const end = dv.getUint16(rec + 2);
      const startIndex = dv.getUint16(rec + 4);
      for (let g = start; g <= end; g++) out[startIndex + (g - start)] = g;
    }
  }
  return out;
}

/**
 * 機能タグの集合から置換関数を作る。Lookup 番号の小さい順に適用する。
 * @param {import('./parse.js').ParsedFont} font
 * @param {string[]} tags
 * @returns {((gid: number) => number)|null}  置換が 1 つも無ければ null
 */
export function buildSubstitution(font, tags) {
  const gsub = parseGsub(font);
  if (!gsub) return null;
  /** @type {number[]} */
  const indices = [];
  for (const tag of tags) for (const i of gsub.features.get(tag) ?? []) if (!indices.includes(i)) indices.push(i);
  if (!indices.length) return null;
  indices.sort((a, b) => a - b);
  /** @type {Map<number, number>[]} */
  const maps = [];
  for (const i of indices) {
    const m = gsub.lookup(i);
    if (m) maps.push(m);
  }
  if (!maps.length) return null;
  /** @type {Map<number, number>} */
  const memo = new Map();
  return (gid) => {
    const hit = memo.get(gid);
    if (hit !== undefined) return hit;
    let g = gid;
    for (const m of maps) g = m.get(g) ?? g;
    memo.set(gid, g);
    return g;
  };
}

/** CSS のキーワード → OpenType の機能タグ */
const VARIANT_TAGS = /** @type {Record<string, string>} */ ({
  // font-variant-numeric
  'lining-nums': 'lnum',
  'oldstyle-nums': 'onum',
  'proportional-nums': 'pnum',
  'tabular-nums': 'tnum',
  'diagonal-fractions': 'frac',
  'stacked-fractions': 'afrc',
  ordinal: 'ordn',
  'slashed-zero': 'zero',
  // font-variant-caps
  'small-caps': 'smcp',
  'all-small-caps': 'c2sc',
  'petite-caps': 'pcap',
  'all-petite-caps': 'c2pc',
  unicase: 'unic',
  'titling-caps': 'titl',
  // font-variant-east-asian
  jis78: 'jp78',
  jis83: 'jp83',
  jis90: 'jp90',
  jis04: 'jp04',
  simplified: 'smpl',
  traditional: 'trad',
  'full-width': 'fwid',
  'proportional-width': 'pwid',
  ruby: 'ruby',
});

/**
 * computed style から、ブラウザが有効にしている機能タグを集める。
 * 既定で有効な機能（ccmp / liga / calt）は含めない（合字は扱えないため）。
 *
 * @param {CSSStyleDeclaration} style
 * @returns {string[]}
 */
export function featureTagsOf(style) {
  /** @type {Set<string>} */
  const tags = new Set();
  const words = `${style.fontVariantNumeric ?? ''} ${style.fontVariantCaps ?? ''} ${style.fontVariantEastAsian ?? ''}`.split(/\s+/);
  for (const w of words) {
    const tag = VARIANT_TAGS[w];
    if (tag) tags.add(tag);
  }
  // font-feature-settings: "zero" 1, "jp90"
  const ffs = style.fontFeatureSettings ?? '';
  if (ffs && ffs !== 'normal') {
    for (const part of ffs.split(',')) {
      const m = /^\s*["']([A-Za-z0-9]{4})["']\s*(.*)$/.exec(part);
      if (!m) continue;
      const value = /** @type {string} */ (m[2]).trim();
      if (value === '0' || value === 'off') continue;
      tags.add(/** @type {string} */ (m[1]));
    }
  }
  return [...tags];
}
