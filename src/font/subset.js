// @ts-check
/**
 * TrueType サブセッター。
 * 使用グリフ（と複合グリフが参照するコンポーネント）だけを含む新しい sfnt を組み立てる。
 * GID は 0 から詰め直され、旧 GID → 新 GID の対応表を返す。
 * cmap は出力しない（PDF 側では CIDToGIDMap /Identity で CID = 新 GID として扱う）。
 */
import { glyphData, componentGids } from './parse.js';
import { concat } from '../pdf/writer.js';

/**
 * @typedef {object} SubsetResult
 * @property {Uint8Array} data          サブセット化されたフォントファイル
 * @property {Map<number, number>} gidMap  旧 GID → 新 GID
 * @property {number[]} oldGids         新 GID 順に並んだ旧 GID
 */

/**
 * @param {import('./parse.js').ParsedFont} font
 * @param {Iterable<number>} usedGids
 * @returns {SubsetResult}
 */
export function subsetFont(font, usedGids) {
  // 1. グリフ集合を閉包する（複合グリフのコンポーネントを再帰的に追加）
  /** @type {Set<number>} */
  const set = new Set([0]);
  const stack = [...usedGids];
  while (stack.length) {
    const gid = /** @type {number} */ (stack.pop());
    if (gid < 0 || gid >= font.numGlyphs || set.has(gid)) continue;
    set.add(gid);
    for (const c of componentGids(glyphData(font, gid))) if (!set.has(c)) stack.push(c);
  }
  const oldGids = [...set].sort((a, b) => a - b);
  /** @type {Map<number, number>} */
  const gidMap = new Map();
  oldGids.forEach((g, i) => gidMap.set(g, i));
  const n = oldGids.length;

  // 2. glyf / loca
  /** @type {Uint8Array[]} */
  const glyphChunks = [];
  const loca = new Uint32Array(n + 1);
  let glyfLen = 0;
  for (let i = 0; i < n; i++) {
    let g = glyphData(font, /** @type {number} */ (oldGids[i]));
    if (g.length && new DataView(g.buffer, g.byteOffset, g.byteLength).getInt16(0) < 0) {
      g = remapComposite(g, gidMap);
    }
    loca[i] = glyfLen;
    glyphChunks.push(g);
    glyfLen += g.length;
    const pad = (4 - (glyfLen % 4)) % 4;
    if (pad) {
      glyphChunks.push(new Uint8Array(pad));
      glyfLen += pad;
    }
  }
  loca[n] = glyfLen;
  const glyf = concat(glyphChunks);
  const locaBytes = new Uint8Array(loca.length * 4);
  const ldv = new DataView(locaBytes.buffer);
  loca.forEach((v, i) => ldv.setUint32(i * 4, v));

  // 3. hmtx（全グリフ分の advance + lsb を書く）
  const origHmtx = /** @type {{offset: number, length: number}} */ (font.tables.get('hmtx'));
  const origHhea = /** @type {{offset: number, length: number}} */ (font.tables.get('hhea'));
  const fdv = new DataView(font.data.buffer, font.data.byteOffset, font.data.byteLength);
  const numberOfHMetrics = fdv.getUint16(origHhea.offset + 34);
  const hmtx = new Uint8Array(n * 4);
  const hdv = new DataView(hmtx.buffer);
  for (let i = 0; i < n; i++) {
    const old = /** @type {number} */ (oldGids[i]);
    const lsbOffset =
      old < numberOfHMetrics
        ? origHmtx.offset + old * 4 + 2
        : origHmtx.offset + numberOfHMetrics * 4 + (old - numberOfHMetrics) * 2;
    hdv.setUint16(i * 4, font.advances[old] ?? 0);
    hdv.setInt16(i * 4 + 2, lsbOffset + 2 <= font.data.byteLength ? fdv.getInt16(lsbOffset) : 0);
  }

  // 4. head / hhea / maxp をコピーして書き換え
  const head = copyTable(font, 'head');
  const headDv = new DataView(head.buffer);
  headDv.setUint32(8, 0); // checkSumAdjustment（後で計算）
  headDv.setInt16(50, 1); // indexToLocFormat = long

  const hhea = copyTable(font, 'hhea');
  new DataView(hhea.buffer).setUint16(34, n);

  const maxp = copyTable(font, 'maxp');
  new DataView(maxp.buffer).setUint16(4, n);

  // 5. テーブル群を組み立てる（タグ順にソート）
  /** @type {[string, Uint8Array][]} */
  const tables = [
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', locaBytes],
    ['maxp', maxp],
  ];
  for (const opt of ['cvt ', 'fpgm', 'prep']) {
    if (font.tables.has(opt)) tables.push([opt, copyTable(font, opt)]);
  }
  tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const data = buildSfnt(tables);
  return { data, gidMap, oldGids };
}

/**
 * @param {import('./parse.js').ParsedFont} font
 * @param {string} tag
 * @returns {Uint8Array}
 */
function copyTable(font, tag) {
  const t = font.tables.get(tag);
  if (!t) throw new Error(`missing table ${tag}`);
  // Node の Buffer は slice がビューを返すため、必ずコピーを作る
  return new Uint8Array(font.data.subarray(t.offset, t.offset + t.length));
}

/**
 * 複合グリフ内のコンポーネント GID を新 GID に書き換える。
 * @param {Uint8Array} g
 * @param {Map<number, number>} gidMap
 * @returns {Uint8Array}
 */
function remapComposite(g, gidMap) {
  const out = new Uint8Array(g);
  const dv = new DataView(out.buffer);
  let p = 10;
  for (;;) {
    const flags = dv.getUint16(p);
    const oldGid = dv.getUint16(p + 2);
    dv.setUint16(p + 2, gidMap.get(oldGid) ?? 0);
    p += 4;
    p += flags & 0x0001 ? 4 : 2;
    if (flags & 0x0008) p += 2;
    else if (flags & 0x0040) p += 4;
    else if (flags & 0x0080) p += 8;
    if (!(flags & 0x0020)) break;
    if (p >= out.length) break;
  }
  return out;
}

/**
 * テーブル群から sfnt ファイルを組み立てる。
 * @param {[string, Uint8Array][]} tables タグ順にソート済み
 * @returns {Uint8Array}
 */
function buildSfnt(tables) {
  const numTables = tables.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const dirLen = 12 + numTables * 16;
  let offset = dirLen;
  /** @type {{tag: string, data: Uint8Array, offset: number, checksum: number}[]} */
  const entries = [];
  for (const [tag, data] of tables) {
    entries.push({ tag, data, offset, checksum: checksum(data) });
    offset += (data.length + 3) & ~3;
  }

  const out = new Uint8Array(offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, numTables);
  dv.setUint16(6, searchRange);
  dv.setUint16(8, entrySelector);
  dv.setUint16(10, rangeShift);
  entries.forEach((e, i) => {
    const p = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[p + k] = e.tag.charCodeAt(k);
    dv.setUint32(p + 4, e.checksum);
    dv.setUint32(p + 8, e.offset);
    dv.setUint32(p + 12, e.data.length);
    out.set(e.data, e.offset);
  });

  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(whole font)
  const headEntry = entries.find((e) => e.tag === 'head');
  if (headEntry) {
    const total = checksum(out);
    dv.setUint32(headEntry.offset + 8, (0xb1b0afba - total) >>> 0);
  }
  return out;
}

/**
 * @param {Uint8Array} data
 * @returns {number}
 */
function checksum(data) {
  let sum = 0;
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    const b0 = data[i] ?? 0;
    const b1 = data[i + 1] ?? 0;
    const b2 = data[i + 2] ?? 0;
    const b3 = data[i + 3] ?? 0;
    sum = (sum + (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0)) >>> 0;
  }
  return sum;
}
