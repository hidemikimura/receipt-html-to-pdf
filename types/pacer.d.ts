/**
 * @typedef {() => Promise<void>} Pacer
 */
/**
 * @param {number} [intervalMs]  この時間を超えて動き続けていたら譲る
 * @returns {Pacer}
 */
export function createPacer(intervalMs?: number): Pacer;
/** 何もしない Pacer（テストや同期実行したい場合に使う） */
export const noPacer: Pacer;
export type Pacer = () => Promise<void>;
