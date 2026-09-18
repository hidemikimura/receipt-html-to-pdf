/** @param {number} n */
export function hex4(n: number): string;
/**
 * PDF に埋め込む 1 フォント分の使用状況。
 * 走査中に addGlyph でグリフを集め、最後に embed で PDF オブジェクトを生成する。
 */
export class EmbeddedFont {
    /**
     * @param {import('./parse.js').ParsedFont} font
     * @param {string} resourceName ページリソース名（F1 など）
     */
    constructor(font: import("./parse.js").ParsedFont, resourceName: string);
    font: import("./parse.js").ParsedFont;
    resourceName: string;
    /** @type {Map<number, number>} 旧 GID → 代表コードポイント（ToUnicode 用） */
    usedGids: Map<number, number>;
    /** @type {import('./subset.js').SubsetResult|null} */
    subset: import("./subset.js").SubsetResult | null;
    /**
     * @param {number} gid 旧 GID
     * @param {number} codePoint
     */
    addGlyph(gid: number, codePoint: number): void;
    /**
     * 旧 GID を PDF 上の CID（サブセット後 GID）へ変換する。embed 後にのみ有効。
     * @param {number} gid
     * @returns {number}
     */
    cid(gid: number): number;
    /**
     * サブセット化を確定させる。以後 cid() が使える。
     */
    finalize(): import("./subset.js").SubsetResult;
    /**
     * PDF オブジェクト群を書き込み、Type0 フォント辞書への参照を返す。
     * @param {import('../pdf/writer.js').PdfWriter} writer
     * @returns {Promise<import('../pdf/writer.js').Ref>}
     */
    embed(writer: import("../pdf/writer.js").PdfWriter): Promise<import("../pdf/writer.js").Ref>;
}
