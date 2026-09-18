// @ts-check
/**
 * デコード済み画像を PDF の Image XObject として書き出す。
 */

/**
 * @param {import('../pdf/writer.js').PdfWriter} writer
 * @param {import('../walker/image.js').DecodedImage} img
 * @returns {Promise<import('../pdf/writer.js').Ref>}
 */
export async function embedImage(writer, img) {
  /** @type {{[key: string]: import('../pdf/writer.js').PdfValue}} */
  const dict = {
    Type: 'XObject',
    Subtype: 'Image',
    Width: img.width,
    Height: img.height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  };
  if (img.jpeg) {
    dict.Filter = 'DCTDecode';
    return writer.addStream(dict, img.jpeg, { compress: false });
  }
  if (!img.rgb) throw new Error('embedImage: image has no pixel data');
  if (img.alpha) {
    dict.SMask = await writer.addStream(
      { Type: 'XObject', Subtype: 'Image', Width: img.width, Height: img.height, ColorSpace: 'DeviceGray', BitsPerComponent: 8 },
      img.alpha,
    );
  }
  return writer.addStream(dict, img.rgb);
}
