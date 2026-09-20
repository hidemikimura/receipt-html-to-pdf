/**
 * @typedef {{page: number, x: number, y: number}} DestPoint  飛び先（0 始まりのページ番号と、そのページの PDF 座標）
 */
/**
 * リンク注釈を作る。
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{x: number, y: number, w: number, h: number}} rect  PDF 座標（左下原点）
 * @param {{uri: string}|{dest: import('./writer.js').PdfValue}} action
 * @returns {import('./writer.js').Ref}
 */
export function buildLinkAnnot(writer: import("./writer.js").PdfWriter, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, action: {
    uri: string;
} | {
    dest: import("./writer.js").PdfValue;
}): import("./writer.js").Ref;
/**
 * 見出しの並びから、レベルに応じた木構造のしおりを作り、カタログに入れる参照を返す。
 * 飛び先が解決できない見出しは飛ばす。
 *
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{level: number, text: string, dest: import('./writer.js').PdfValue|null}[]} entries
 * @returns {import('./writer.js').Ref|null}
 */
export function buildOutline(writer: import("./writer.js").PdfWriter, entries: {
    level: number;
    text: string;
    dest: import("./writer.js").PdfValue | null;
}[]): import("./writer.js").Ref | null;
/**
 * 飛び先（0 始まりのページ番号と、そのページの PDF 座標）
 */
export type DestPoint = {
    page: number;
    x: number;
    y: number;
};
