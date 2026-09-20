/**
 * SVG のパスデータと基本図形を、PDF に出せる形（絶対座標の M / L / C / Z）へ正規化する。
 *
 * 円弧（A）は 3 次ベジェへ、二次ベジェ（Q / T）も 3 次へ変換する。
 * 座標は要素のユーザー単位のまま（変換行列は描画時に cm で適用する）。
 */
/**
 * @typedef {['M', number, number]|['L', number, number]|['C', number, number, number, number, number, number]|['Z']} PathSeg
 */
/**
 * `d` 属性を絶対座標の M / L / C / Z 列にする。
 * @param {string} d
 * @returns {PathSeg[]}
 */
export function parsePathData(d: string): PathSeg[];
/**
 * 楕円円弧を 3 次ベジェ列にする（SVG 仕様 F.6 の実装）。
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} rx @param {number} ry @param {number} rotDeg
 * @param {boolean} large @param {boolean} sweep
 * @returns {PathSeg[]}
 */
export function arcToCurves(x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean): PathSeg[];
/**
 * 基本図形をパスにする。対応しない要素は null。
 * @param {Element} el
 * @param {(name: string) => string} attr  属性値（プレゼンテーション属性は computed style を優先しない純粋な幾何属性）
 * @returns {PathSeg[]|null}
 */
export function shapeToPath(el: Element, attr: (name: string) => string): PathSeg[] | null;
export type PathSeg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];
