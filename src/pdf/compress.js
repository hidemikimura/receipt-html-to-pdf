// @ts-check
/**
 * Web 標準 CompressionStream による zlib (FlateDecode) 圧縮。
 * 未対応環境では null を返し、呼び出し側は無圧縮で出力する。
 */

/**
 * @returns {boolean}
 */
export function canCompress() {
  return typeof CompressionStream === 'function';
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array|null>} zlib 形式（PDF の FlateDecode が期待する形式）
 */
export async function deflate(bytes) {
  if (!canCompress()) return null;
  try {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    void writer.write(/** @type {Uint8Array<ArrayBuffer>} */ (bytes));
    void writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
