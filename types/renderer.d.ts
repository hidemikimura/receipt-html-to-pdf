/**
 * 非表示 iframe に HTML を描画し、レイアウト計測可能な Document を用意する。
 */
/**
 * @typedef {object} RenderedDocument
 * @property {HTMLIFrameElement} iframe
 * @property {Document} doc
 * @property {Window} win
 * @property {HTMLElement} root   走査の起点（body）
 * @property {() => void} destroy
 */
/**
 * @param {import('./index.js').ConvertInput} input
 * @param {{widthPx: number, stylesheets: 'inherit'|'none'|string[], mediaPrint: boolean, baseUrl?: string, warn?: (w: import('./index.js').ConversionWarning) => void}} opts
 * @returns {Promise<RenderedDocument>}
 */
export function renderDocument(input: import("./index.js").ConvertInput, opts: {
    widthPx: number;
    stylesheets: "inherit" | "none" | string[];
    mediaPrint: boolean;
    baseUrl?: string;
    warn?: (w: import("./index.js").ConversionWarning) => void;
}): Promise<RenderedDocument>;
/**
 * `@media print { ... }` ブロックを通常ルールとして展開し、`@media screen { ... }` を除去する。
 * 単純な括弧の対応で処理する（ネストした @media は想定しない）。
 * @param {string} css
 * @returns {string}
 */
export function expandPrintMediaCss(css: string): string;
/**
 * ::before / ::after を実体の <span> に置き換える。
 * 擬似要素は DOM ノードを持たず Range で計測できないため、computed style をすべて写した span を
 * 同じ位置に挿入し、元の擬似要素は content: none で消す。文字列 content のみ対応（counter / url は警告）。
 * @param {Document} doc
 * @param {(w: import('./index.js').ConversionWarning) => void} warn
 */
export function materializePseudoElements(doc: Document, warn: (w: import("./index.js").ConversionWarning) => void): void;
/**
 * computed content 値（'"※ "' / '"a" "b"' / 'counter(x)' …）から文字列を取り出す。
 * 文字列以外のトークンが含まれる場合は null。
 * @param {string} value
 * @returns {string|null}
 */
export function parseContentString(value: string): string | null;
export type RenderedDocument = {
    iframe: HTMLIFrameElement;
    doc: Document;
    win: Window;
    /**
     * 走査の起点（body）
     */
    root: HTMLElement;
    destroy: () => void;
};
