/**
 * Web 標準 CompressionStream による zlib (FlateDecode) 圧縮。
 * 未対応環境では null を返し、呼び出し側は無圧縮で出力する。
 */
/**
 * @returns {boolean}
 */
export function canCompress(): boolean;
/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array|null>} zlib 形式（PDF の FlateDecode が期待する形式）
 */
export function deflate(bytes: Uint8Array): Promise<Uint8Array | null>;
