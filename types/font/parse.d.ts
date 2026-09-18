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
export function parseFont(buffer: ArrayBuffer | Uint8Array): ParsedFont;
/**
 * グリフの生バイト列を返す（空グリフは長さ 0）。
 * @param {ParsedFont} font
 * @param {number} gid
 * @returns {Uint8Array}
 */
export function glyphData(font: ParsedFont, gid: number): Uint8Array;
/**
 * 複合グリフが参照するコンポーネント GID を返す（単純グリフなら空）。
 * @param {Uint8Array} g
 * @returns {number[]}
 */
export function componentGids(g: Uint8Array): number[];
/**
 * ブラウザが行ボックス計算に使うアセント／ディセントに近い値（font units）を返す。
 * Chrome/Firefox は OS/2 USE_TYPO_METRICS が立っていれば typo、そうでなければ hhea を使う。
 * @param {ParsedFont} font
 * @returns {{ascent: number, descent: number}} descent は正値
 */
export function browserMetrics(font: ParsedFont): {
    ascent: number;
    descent: number;
};
export type ParsedFont = {
    data: Uint8Array;
    tables: Map<string, {
        offset: number;
        length: number;
    }>;
    unitsPerEm: number;
    indexToLocFormat: number;
    /**
     * xMin yMin xMax yMax (font units)
     */
    bbox: [number, number, number, number];
    /**
     * hhea
     */
    ascender: number;
    /**
     * hhea（負値）
     */
    descender: number;
    lineGap: number;
    numGlyphs: number;
    /**
     * グリフごとの advance width (font units)
     */
    advances: Uint16Array;
    /**
     * numGlyphs + 1 要素
     */
    loca: Uint32Array;
    /**
     * コードポイント → GID
     */
    cmap: Map<number, number>;
    /**
     * OS/2 sCapHeight（なければ ascender * 0.7）
     */
    capHeight: number;
    italicAngle: number;
    /**
     * OS/2 fsSelection bit 7
     */
    useTypoMetrics: boolean;
    typoAscender: number;
    typoDescender: number;
    winAscent: number;
    winDescent: number;
    postScriptName: string;
    bold: boolean;
    italic: boolean;
    /**
     * fvar テーブルを持つ可変フォントか
     */
    variable: boolean;
};
