/**
 * デコード済み画像を PDF の Image XObject として書き出す。
 */
/**
 * @param {import('../pdf/writer.js').PdfWriter} writer
 * @param {import('../walker/image.js').DecodedImage} img
 * @returns {Promise<import('../pdf/writer.js').Ref>}
 */
export function embedImage(writer: import("../pdf/writer.js").PdfWriter, img: import("../walker/image.js").DecodedImage): Promise<import("../pdf/writer.js").Ref>;
