// @ts-check
/**
 * サブセット化した TrueType を PDF の Type0 / CIDFontType2 として埋め込む。
 * CID = サブセット後の GID（CIDToGIDMap /Identity）、エンコーディングは Identity-H。
 * ToUnicode CMap を必ず付けてテキスト選択・検索・コピーを保証する。
 */
import { Raw } from '../pdf/writer.js';
import { subsetFont } from './subset.js';

/**
 * PDF に埋め込む 1 フォント分の使用状況。
 * 走査中に addGlyph でグリフを集め、最後に embed で PDF オブジェクトを生成する。
 */
export class EmbeddedFont {
  /**
   * @param {import('./parse.js').ParsedFont} font
   * @param {string} resourceName ページリソース名（F1 など）
   */
  constructor(font, resourceName) {
    this.font = font;
    this.resourceName = resourceName;
    /** @type {Map<number, number>} 旧 GID → 代表コードポイント（ToUnicode 用） */
    this.usedGids = new Map();
    /** @type {import('./subset.js').SubsetResult|null} */
    this.subset = null;
  }

  /**
   * @param {number} gid 旧 GID
   * @param {number} codePoint
   */
  addGlyph(gid, codePoint) {
    if (!this.usedGids.has(gid)) this.usedGids.set(gid, codePoint);
  }

  /**
   * 旧 GID を PDF 上の CID（サブセット後 GID）へ変換する。embed 後にのみ有効。
   * @param {number} gid
   * @returns {number}
   */
  cid(gid) {
    if (!this.subset) throw new Error('EmbeddedFont: embed() must be called before cid()');
    return this.subset.gidMap.get(gid) ?? 0;
  }

  /**
   * サブセット化を確定させる。以後 cid() が使える。
   */
  finalize() {
    if (!this.subset) this.subset = subsetFont(this.font, this.usedGids.keys());
    return this.subset;
  }

  /**
   * PDF オブジェクト群を書き込み、Type0 フォント辞書への参照を返す。
   * @param {import('../pdf/writer.js').PdfWriter} writer
   * @returns {Promise<import('../pdf/writer.js').Ref>}
   */
  async embed(writer) {
    const subset = this.finalize();
    const f = this.font;
    const scale = 1000 / f.unitsPerEm;
    const tag = subsetTag(this.usedGids);
    const baseFont = `${tag}+${f.postScriptName}`;

    const fontFile = await writer.addStream({ Length1: subset.data.length }, subset.data);

    // フラグ: bit 3 (Symbolic) を立てる。Nonsymbolic と排他。Italic は bit 7、ForceBold は bit 19。
    let flags = 4;
    if (f.italic) flags |= 1 << 6;
    if (f.bold) flags |= 1 << 18;

    const descriptor = writer.add({
      Type: 'FontDescriptor',
      FontName: baseFont,
      Flags: flags,
      FontBBox: f.bbox.map((v) => Math.round(v * scale)),
      ItalicAngle: f.italicAngle,
      Ascent: Math.round(f.ascender * scale),
      Descent: Math.round(f.descender * scale),
      CapHeight: Math.round(f.capHeight * scale),
      StemV: f.bold ? 120 : 80,
      FontFile2: fontFile,
    });

    // W 配列: 連続 CID をまとめる  c [w1 w2 ...] 形式
    /** @type {import('../pdf/writer.js').PdfValue[]} */
    const W = [];
    const widths = subset.oldGids.map((g) => Math.round((f.advances[g] ?? 0) * scale));
    let i = 0;
    while (i < widths.length) {
      let j = i;
      while (j + 1 < widths.length && j - i < 100) j++;
      W.push(i, widths.slice(i, j + 1));
      i = j + 1;
    }

    const cidFont = writer.add({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: baseFont,
      CIDSystemInfo: { Registry: new Raw('(Adobe)'), Ordering: new Raw('(Identity)'), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: 1000,
      W,
      CIDToGIDMap: 'Identity',
    });

    const toUnicode = await writer.addStream({}, buildToUnicode(subset, this.usedGids));

    return writer.add({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: baseFont,
      Encoding: 'Identity-H',
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode,
    });
  }
}

/**
 * サブセットフォント名の接頭辞（6 文字の大文字）。使用グリフ集合から決定的に生成する。
 * @param {Map<number, number>} usedGids
 * @returns {string}
 */
function subsetTag(usedGids) {
  let h = 2166136261;
  for (const g of usedGids.keys()) {
    h ^= g;
    h = Math.imul(h, 16777619) >>> 0;
  }
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26);
  }
  return tag;
}

/**
 * ToUnicode CMap（bfchar 形式）を生成する。
 * @param {import('./subset.js').SubsetResult} subset
 * @param {Map<number, number>} usedGids 旧 GID → コードポイント
 * @returns {Uint8Array}
 */
function buildToUnicode(subset, usedGids) {
  /** @type {string[]} */
  const entries = [];
  subset.oldGids.forEach((oldGid, cid) => {
    const cp = usedGids.get(oldGid);
    if (cp === undefined) return;
    entries.push(`<${hex4(cid)}> <${utf16Hex(cp)}>`);
  });

  let body = '';
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`;
  }

  const cmap =
    `/CIDInit /ProcSet findresource begin\n` +
    `12 dict begin\nbegincmap\n` +
    `/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n` +
    `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n` +
    `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n` +
    body +
    `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
  return new TextEncoder().encode(cmap);
}

/** @param {number} n */
export function hex4(n) {
  return n.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * コードポイントを UTF-16BE の 16 進表記にする（サロゲートペア対応）。
 * @param {number} cp
 */
function utf16Hex(cp) {
  if (cp <= 0xffff) return hex4(cp);
  const v = cp - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}

