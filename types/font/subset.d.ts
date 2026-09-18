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
export function subsetFont(font: import("./parse.js").ParsedFont, usedGids: Iterable<number>): SubsetResult;
export type SubsetResult = {
    /**
     * サブセット化されたフォントファイル
     */
    data: Uint8Array;
    /**
     * 旧 GID → 新 GID
     */
    gidMap: Map<number, number>;
    /**
     * 新 GID 順に並んだ旧 GID
     */
    oldGids: number[];
};
