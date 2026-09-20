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
/**
 * `background-repeat` の computed 値を軸ごとに分ける。
 * `repeat-x` / `repeat-y` は 2 値表記に展開する。
 * @param {string} value
 * @returns {['repeat'|'no-repeat'|'space'|'round', 'repeat'|'no-repeat'|'space'|'round']}
 */
export function splitRepeat(value: string): ["repeat" | "no-repeat" | "space" | "round", "repeat" | "no-repeat" | "space" | "round"];
/**
 * 1 軸ぶんのタイル位置を求める。
 *
 * - `repeat`: 指定位置を基準に、描画領域を覆うまで両方向へ並べる
 * - `no-repeat`: 指定位置に 1 枚
 * - `round`: 描画領域に整数個収まるようタイルの大きさを調整して並べる（大きさが変わる）
 * - `space`: 整数個を等間隔に置き、余りを隙間に配る。1 枚しか入らないなら先頭に 1 枚
 *
 * @param {'repeat'|'no-repeat'|'space'|'round'} mode
 * @param {number} start      指定位置（background-position の結果）
 * @param {number} size       タイルの大きさ
 * @param {number} areaStart  描画領域の開始
 * @param {number} areaEnd    描画領域の終わり
 * @returns {{positions: number[], size: number}}
 */
export function tileAxis(mode: "repeat" | "no-repeat" | "space" | "round", start: number, size: number, areaStart: number, areaEnd: number): {
    positions: number[];
    size: number;
};
/**
 * 埋め込みが済んだ画像のピクセルデータを手放す。
 * デコード結果（RGB・アルファ・JPEG のバイト列）は元画像より桁違いに大きいので、
 * PDF に書き出したあとも抱えていると大きな文書でピーク使用量が跳ね上がる。
 *
 * キャッシュからも外すので、次の変換では読み直しになる（速度よりメモリを優先する）。
 *
 * @param {DecodedImage} img
 */
export function releasePixels(img: DecodedImage): void;
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
