// @ts-check
/**
 * TrueType (sfnt / glyf アウトライン) フォントの最小パーサー。
 * サブセット化と PDF 埋め込みに必要なテーブルだけを読む。
 */

/**
 * @typedef {object} ParsedFont
 * @property {Uint8Array} data
 * @property {Map<string, {offset: number, length: number}>} tables
 * @property {number} unitsPerEm
 * @property {number} indexToLocFormat
 * @property {[number, number, number, number]} bbox  xMin yMin xMax yMax (font units)
 * @property {number} ascender       hhea
 * @property {number} descender      hhea（負値）
 * @property {number} lineGap
 * @property {number} numGlyphs
 * @property {Uint16Array} advances  グリフごとの advance width (font units)
 * @property {Uint32Array} loca      numGlyphs + 1 要素
 * @property {Map<number, number>} cmap  コードポイント → GID
 * @property {number} capHeight      OS/2 sCapHeight（なければ ascender * 0.7）
 * @property {number} italicAngle
 * @property {boolean} useTypoMetrics OS/2 fsSelection bit 7
 * @property {number} typoAscender
 * @property {number} typoDescender
 * @property {number} winAscent
 * @property {number} winDescent
 * @property {string} postScriptName
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} variable  fvar テーブルを持つ可変フォントか
 */

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {ParsedFont}
 */
export function parseFont(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const tag = dv.getUint32(0);
  if (tag === 0x4f54544f /* 'OTTO' */) {
    throw new Error('CFF outlines (OpenType/CFF) are not supported. Use a TrueType (glyf) font.');
  }
  if (tag === 0x774f4646 /* 'wOFF' */ || tag === 0x774f4632 /* 'wOF2' */) {
    throw new Error('WOFF/WOFF2 are not supported. Use a raw .ttf file.');
  }
  if (tag === 0x74746366 /* 'ttcf' */) {
    throw new Error('TrueType collections (.ttc) are not supported. Extract a single face first.');
  }
  if (tag !== 0x00010000 && tag !== 0x74727565 /* 'true' */) {
    throw new Error('Not a TrueType font (bad sfnt version)');
  }

  const numTables = dv.getUint16(4);
  /** @type {Map<string, {offset: number, length: number}>} */
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const name = String.fromCharCode(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0, data[p + 3] ?? 0);
    tables.set(name, { offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) });
  }
  if (tables.has('CFF ')) throw new Error('CFF outlines are not supported. Use a TrueType (glyf) font.');
  // 可変フォント: glyf にはデフォルトインスタンスのみ入っている。呼び出し側が警告できるようフラグを立てる。
  const variable = tables.has('fvar');
  for (const req of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf']) {
    if (!tables.has(req)) throw new Error(`Font is missing required table: ${req}`);
  }

  const t = (/** @type {string} */ name) => /** @type {{offset: number, length: number}} */ (tables.get(name));

  // head
  const head = t('head');
  const unitsPerEm = dv.getUint16(head.offset + 18);
  const bbox = /** @type {[number, number, number, number]} */ ([
    dv.getInt16(head.offset + 36),
    dv.getInt16(head.offset + 38),
    dv.getInt16(head.offset + 40),
    dv.getInt16(head.offset + 42),
  ]);
  const macStyle = dv.getUint16(head.offset + 44);
  const indexToLocFormat = dv.getInt16(head.offset + 50);

  // hhea
  const hhea = t('hhea');
  const ascender = dv.getInt16(hhea.offset + 4);
  const descender = dv.getInt16(hhea.offset + 6);
  const lineGap = dv.getInt16(hhea.offset + 8);
  const numberOfHMetrics = dv.getUint16(hhea.offset + 34);

  // maxp
  const numGlyphs = dv.getUint16(t('maxp').offset + 4);

  // hmtx
  const hmtx = t('hmtx');
  const advances = new Uint16Array(numGlyphs);
  let lastAdvance = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numberOfHMetrics) lastAdvance = dv.getUint16(hmtx.offset + g * 4);
    advances[g] = lastAdvance;
  }

  // loca
  const locaT = t('loca');
  const loca = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g <= numGlyphs; g++) {
    loca[g] = indexToLocFormat === 0 ? dv.getUint16(locaT.offset + g * 2) * 2 : dv.getUint32(locaT.offset + g * 4);
  }

  // cmap（サブセット出力には含まれないため省略可。無ければ空）
  const cmapT = tables.get('cmap');
  const cmap = cmapT ? parseCmap(dv, cmapT.offset) : new Map();

  // OS/2 (optional)
  let capHeight = Math.round(ascender * 0.7);
  let useTypoMetrics = false;
  let typoAscender = ascender;
  let typoDescender = descender;
  let winAscent = ascender;
  let winDescent = -descender;
  let bold = (macStyle & 1) !== 0;
  let italic = (macStyle & 2) !== 0;
  const os2 = tables.get('OS/2');
  if (os2) {
    const version = dv.getUint16(os2.offset);
    const fsSelection = dv.getUint16(os2.offset + 62);
    useTypoMetrics = (fsSelection & (1 << 7)) !== 0;
    bold = bold || (fsSelection & (1 << 5)) !== 0;
    italic = italic || (fsSelection & 1) !== 0;
    typoAscender = dv.getInt16(os2.offset + 68);
    typoDescender = dv.getInt16(os2.offset + 70);
    winAscent = dv.getUint16(os2.offset + 74);
    winDescent = dv.getUint16(os2.offset + 76);
    if (version >= 2 && os2.length >= 90) {
      const ch = dv.getInt16(os2.offset + 88);
      if (ch > 0) capHeight = ch;
    }
  }

  // post (optional) — italicAngle
  let italicAngle = 0;
  const post = tables.get('post');
  if (post) italicAngle = dv.getInt32(post.offset + 4) / 65536;

  const postScriptName = parsePostScriptName(dv, data, tables.get('name')) ?? 'Embedded';

  return {
    data,
    tables,
    unitsPerEm,
    indexToLocFormat,
    bbox,
    ascender,
    descender,
    lineGap,
    numGlyphs,
    advances,
    loca,
    cmap,
    capHeight,
    italicAngle,
    useTypoMetrics,
    typoAscender,
    typoDescender,
    winAscent,
    winDescent,
    postScriptName,
    bold,
    italic,
    variable,
  };
}

/**
 * cmap テーブルから Unicode サブテーブル（format 12 優先、なければ 4）を読む。
 * @param {DataView} dv
 * @param {number} base
 * @returns {Map<number, number>}
 */
function parseCmap(dv, base) {
  const n = dv.getUint16(base + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    const p = base + 4 + i * 8;
    const platform = dv.getUint16(p);
    const encoding = dv.getUint16(p + 2);
    const offset = dv.getUint32(p + 4);
    const format = dv.getUint16(base + offset);
    let score = -1;
    if (platform === 3 && encoding === 10 && format === 12) score = 4;
    else if (platform === 0 && (encoding === 4 || encoding === 6) && format === 12) score = 3;
    else if (platform === 3 && encoding === 1 && format === 4) score = 2;
    else if (platform === 0 && format === 4) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = base + offset;
    }
  }
  if (best < 0) throw new Error('Font has no usable Unicode cmap subtable (format 4 or 12)');

  /** @type {Map<number, number>} */
  const map = new Map();
  const format = dv.getUint16(best);
  if (format === 4) {
    const segCountX2 = dv.getUint16(best + 6);
    const segCount = segCountX2 / 2;
    const endP = best + 14;
    const startP = endP + segCountX2 + 2;
    const deltaP = startP + segCountX2;
    const rangeP = deltaP + segCountX2;
    for (let s = 0; s < segCount; s++) {
      const end = dv.getUint16(endP + s * 2);
      const start = dv.getUint16(startP + s * 2);
      const delta = dv.getInt16(deltaP + s * 2);
      const rangeOffset = dv.getUint16(rangeP + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gp = rangeP + s * 2 + rangeOffset + (c - start) * 2;
          if (gp + 2 > dv.byteLength) continue;
          gid = dv.getUint16(gp);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
  } else if (format === 12) {
    const nGroups = dv.getUint32(best + 12);
    let p = best + 16;
    for (let i = 0; i < nGroups; i++, p += 12) {
      const start = dv.getUint32(p);
      const end = dv.getUint32(p + 4);
      const startGid = dv.getUint32(p + 8);
      for (let c = start; c <= end && c - start < 0x10000; c++) {
        const gid = startGid + (c - start);
        if (gid !== 0) map.set(c, gid);
      }
    }
  }
  return map;
}

/**
 * name テーブルから PostScript 名 (nameID 6) を取り出す。
 * @param {DataView} dv
 * @param {Uint8Array} data
 * @param {{offset: number, length: number}|undefined} nameT
 * @returns {string|null}
 */
function parsePostScriptName(dv, data, nameT) {
  if (!nameT) return null;
  const count = dv.getUint16(nameT.offset + 2);
  const stringOffset = dv.getUint16(nameT.offset + 4);
  let fallback = null;
  for (let i = 0; i < count; i++) {
    const p = nameT.offset + 6 + i * 12;
    const platform = dv.getUint16(p);
    const nameId = dv.getUint16(p + 6);
    const length = dv.getUint16(p + 8);
    const offset = dv.getUint16(p + 10);
    if (nameId !== 6) continue;
    const start = nameT.offset + stringOffset + offset;
    if (platform === 1) {
      // Macintosh Roman: ASCII とみなす
      return sanitizePsName(String.fromCharCode(...data.subarray(start, start + length)));
    }
    if (platform === 3 || platform === 0) {
      let s = '';
      for (let j = 0; j + 1 < length; j += 2) s += String.fromCharCode(dv.getUint16(start + j));
      fallback = sanitizePsName(s);
    }
  }
  return fallback;
}

/** @param {string} s */
function sanitizePsName(s) {
  return s.replace(/[^\x21-\x7e]/g, '').replace(/[\[\]\(\)\{\}<>\/%#]/g, '') || 'Embedded';
}

/**
 * グリフの生バイト列を返す（空グリフは長さ 0）。
 * @param {ParsedFont} font
 * @param {number} gid
 * @returns {Uint8Array}
 */
export function glyphData(font, gid) {
  const glyf = /** @type {{offset: number, length: number}} */ (font.tables.get('glyf'));
  const start = font.loca[gid] ?? 0;
  const end = font.loca[gid + 1] ?? start;
  return font.data.subarray(glyf.offset + start, glyf.offset + end);
}

/**
 * 複合グリフが参照するコンポーネント GID を返す（単純グリフなら空）。
 * @param {Uint8Array} g
 * @returns {number[]}
 */
export function componentGids(g) {
  if (g.length < 10) return [];
  const dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
  const numberOfContours = dv.getInt16(0);
  if (numberOfContours >= 0) return [];
  /** @type {number[]} */
  const out = [];
  let p = 10;
  for (;;) {
    const flags = dv.getUint16(p);
    const glyphIndex = dv.getUint16(p + 2);
    out.push(glyphIndex);
    p += 4;
    p += flags & 0x0001 /* ARG_1_AND_2_ARE_WORDS */ ? 4 : 2;
    if (flags & 0x0008 /* WE_HAVE_A_SCALE */) p += 2;
    else if (flags & 0x0040 /* WE_HAVE_AN_X_AND_Y_SCALE */) p += 4;
    else if (flags & 0x0080 /* WE_HAVE_A_TWO_BY_TWO */) p += 8;
    if (!(flags & 0x0020 /* MORE_COMPONENTS */)) break;
    if (p >= g.length) break;
  }
  return out;
}

/**
 * ブラウザが行ボックス計算に使うアセント／ディセントに近い値（font units）を返す。
 * Chrome/Firefox は OS/2 USE_TYPO_METRICS が立っていれば typo、そうでなければ hhea を使う。
 * @param {ParsedFont} font
 * @returns {{ascent: number, descent: number}} descent は正値
 */
export function browserMetrics(font) {
  if (font.useTypoMetrics) return { ascent: font.typoAscender, descent: -font.typoDescender };
  return { ascent: font.ascender, descent: -font.descender };
}
