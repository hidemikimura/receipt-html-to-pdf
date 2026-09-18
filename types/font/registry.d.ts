/**
 * @param {string} family
 * @returns {string}
 */
export function normalizeFamily(family: string): string;
/**
 * getComputedStyle().fontFamily（'"BIZ UDPGothic", sans-serif'）をリストに分割する。
 * @param {string} value
 * @returns {string[]}
 */
export function splitFamilies(value: string): string[];
/**
 * getComputedStyle().fontWeight（'400' / '700' / 'bold'）を数値にする。
 * @param {string} value
 * @returns {number}
 */
export function parseWeight(value: string): number;
/**
 * @typedef {object} RegisteredFont
 * @property {string} family      正規化済み（小文字・引用符なし）
 * @property {string} displayFamily
 * @property {number} weight
 * @property {'normal'|'italic'} style
 * @property {import('./parse.js').ParsedFont} parsed
 */
export class FontRegistry {
    /** @type {RegisteredFont[]} */
    fonts: RegisteredFont[];
    /**
     * @param {import('../index.js').FontSource} source
     * @returns {Promise<RegisteredFont>}
     */
    register(source: import("../index.js").FontSource): Promise<RegisteredFont>;
    /** @param {string} family */
    hasFamily(family: string): boolean;
    /**
     * CSS の指定に最も近い登録フォントを返す。
     * @param {string[]} families   font-family リスト（優先順）
     * @param {number} weight
     * @param {'normal'|'italic'} style
     * @param {number} [codePoint]  指定するとこの文字のグリフを持つフォントに限定する
     * @returns {RegisteredFont|null}
     */
    match(families: string[], weight: number, style: "normal" | "italic", codePoint?: number): RegisteredFont | null;
    /**
     * 登録済みの全ファミリーの中から、指定文字のグリフを持つものを探す（最終フォールバック）。
     * @param {number} codePoint
     * @param {number} weight
     * @param {'normal'|'italic'} style
     * @returns {RegisteredFont|null}
     */
    anyWithGlyph(codePoint: number, weight: number, style: "normal" | "italic"): RegisteredFont | null;
}
export type RegisteredFont = {
    /**
     * 正規化済み（小文字・引用符なし）
     */
    family: string;
    displayFamily: string;
    weight: number;
    style: "normal" | "italic";
    parsed: import("./parse.js").ParsedFont;
};
