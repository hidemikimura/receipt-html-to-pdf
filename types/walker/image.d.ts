/**
 * @param {string} url  絶対 URL（img.currentSrc または background-image の url()）
 * @param {(w: import('../index.js').ConversionWarning) => void} warn
 * @param {Element} [element]
 * @returns {Promise<DecodedImage|null>}
 */
export function loadImage(url: string, warn: (w: import("../index.js").ConversionWarning) => void, element?: Element): Promise<DecodedImage | null>;
/**
 * JPEG の SOF マーカーから寸法と成分数を読む。
 * @param {Uint8Array} b
 * @returns {{width: number, height: number, components: number}|null}
 */
export function jpegDimensions(b: Uint8Array): {
    width: number;
    height: number;
    components: number;
} | null;
/**
 * computed background-image の `url("...")` を取り出す。複数指定・グラデーションは null。
 * @param {string} value
 * @returns {string|null}
 */
export function parseBackgroundUrl(value: string): string | null;
/**
 * background-size / background-position / object-fit / object-position から描画矩形を計算する。
 * @param {{x: number, y: number, w: number, h: number}} box  描画領域（px）
 * @param {number} iw  画像の固有幅
 * @param {number} ih
 * @param {string} size      'auto' | 'cover' | 'contain' | '<w> <h>'（computed 値、px または %）
 * @param {string} position  '0% 0%' | '50% 50%' | '10px 20px' …（computed 値、2 値）
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function fitImage(box: {
    x: number;
    y: number;
    w: number;
    h: number;
}, iw: number, ih: number, size: string, position: string): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * object-fit を background-size 相当の値に変換する。
 * @param {string} fit
 * @returns {string}
 */
export function objectFitToSize(fit: string): string;
export type DecodedImage = {
    /**
     * 重複排除キー（URL）
     */
    key: string;
    /**
     * ピクセル
     */
    width: number;
    height: number;
    /**
     * JPEG の生バイト列（DCTDecode）
     */
    jpeg: Uint8Array | null;
    /**
     * 幅×高さ×3
     */
    rgb: Uint8Array | null;
    /**
     * 幅×高さ（完全不透明なら null）
     */
    alpha: Uint8Array | null;
};
