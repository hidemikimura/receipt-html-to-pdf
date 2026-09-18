/**
 * CSS 長さ文字列（'15mm', '1in', '12pt', '100px', '2cm'）を pt に変換する。
 * 単位なしの数値は px とみなす。
 * @param {string|number} value
 * @returns {number}
 */
export function lengthToPt(value: string | number): number;
/** @param {number} pt @returns {number} */
export function ptToPx(pt: number): number;
/**
 * getComputedStyle が返す px 文字列（'12px'）を数値にする。
 * @param {string} value
 * @returns {number}
 */
export function cssPx(value: string): number;
/**
 * @typedef {{r: number, g: number, b: number, a: number}} Rgba  各成分 0〜1
 */
/**
 * getComputedStyle の色文字列（'rgb(34, 34, 34)' / 'rgba(0, 0, 0, 0.5)' / 'transparent'
 * / 'color(srgb ...)'）をパースする。パースできない場合は null。
 * @param {string} value
 * @returns {Rgba|null}
 */
export function parseColor(value: string): Rgba | null;
/**
 * PDF 用に数値を丸めて文字列化する（小数第 3 位まで、末尾ゼロ除去）。
 * @param {number} n
 * @returns {string}
 */
export function num(n: number): string;
/**
 * 単位・色の変換ユーティリティ。
 * 内部座標は CSS px（ブラウザ計測値）で持ち、PDF 出力時に pt へ変換する。
 */
/** 1 CSS px = 0.75 pt（96dpi 基準） */
export const PX_TO_PT: 0.75;
/** 1 mm = 72 / 25.4 pt */
export const MM_TO_PT: number;
/** @type {Record<string, {width: number, height: number}>} 用紙サイズ（pt） */
export const PAGE_SIZES: Record<string, {
    width: number;
    height: number;
}>;
/**
 * 各成分 0〜1
 */
export type Rgba = {
    r: number;
    g: number;
    b: number;
    a: number;
};
