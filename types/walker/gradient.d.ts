/**
 * @typedef {{t: number, color: import('../units.js').Rgba}} GradientStop
 * @typedef {{x0: number, y0: number, x1: number, y1: number, stops: GradientStop[]}} LinearGradient
 */
/**
 * computed の background-image が単一の linear-gradient ならそれを解析する。
 * 対応しない書式（repeating / radial / conic / 複数レイヤー）は null。
 *
 * @param {string} value  computed の background-image
 * @param {number} width  箱の幅（px）
 * @param {number} height 箱の高さ（px）
 * @returns {LinearGradient|null}
 */
export function parseLinearGradient(value: string, width: number, height: number): LinearGradient | null;
export type GradientStop = {
    t: number;
    color: import("../units.js").Rgba;
};
export type LinearGradient = {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    stops: GradientStop[];
};
