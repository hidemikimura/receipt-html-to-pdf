/**
 * 軸シェーディングの辞書を作る。座標は PDF 座標（pt）。
 *
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{x0: number, y0: number, x1: number, y1: number}} coords
 * @param {GradientStop[]} stops
 * @param {'rgb'|'gray'} space
 * @returns {import('./writer.js').Ref}
 */
export function buildAxialShading(writer: import("./writer.js").PdfWriter, coords: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}, stops: GradientStop[], space: "rgb" | "gray"): import("./writer.js").Ref;
/**
 * 色止めのアルファが一定ならその値、そうでなければ null。
 * @param {GradientStop[]} stops
 * @returns {number|null}
 */
export function uniformAlpha(stops: GradientStop[]): number | null;
/**
 * アルファが変化するグラデーション用の輝度ソフトマスクを作る。
 * グレースケールのシェーディングを描くフォーム XObject を /SMask に入れた ExtGState を返す。
 *
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{x0: number, y0: number, x1: number, y1: number}} coords  PDF 座標
 * @param {GradientStop[]} stops
 * @param {{x: number, y: number, w: number, h: number}} bbox  マスクを塗る範囲（PDF 座標）
 * @param {number} groupAlpha  要素から継承した不透明度（グラデーション全体に掛かる）
 * @returns {Promise<import('./writer.js').Ref>} ExtGState の参照
 */
export function buildAlphaMaskGState(writer: import("./writer.js").PdfWriter, coords: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}, stops: GradientStop[], bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
}, groupAlpha: number): Promise<import("./writer.js").Ref>;
export type GradientStop = import("../walker/gradient.js").GradientStop;
