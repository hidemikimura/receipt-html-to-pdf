/**
 * @typedef {object} PageGeometry
 * @property {number} width   pt
 * @property {number} height  pt
 * @property {number} top     pt  上余白
 * @property {number} right   pt
 * @property {number} bottom  pt  下余白
 * @property {number} left    pt
 */
/**
 * @typedef {object} PageDecoration  ヘッダー／フッター（ページごとに描画済みの走査結果）
 * @property {number} heightPx
 * @property {(pageNumber: number, totalPages: number) => Promise<import('./walker/walk.js').WalkResult>} render
 */
/**
 * @param {import('./index.js').PageOptions|undefined} page
 * @returns {PageGeometry}
 */
export function resolvePage(page?: import("./index.js").PageOptions | undefined): PageGeometry;
/**
 * @param {import('./walker/walk.js').WalkResult} body
 * @param {PageGeometry} geo
 * @param {{compress: boolean, metadata?: import('./index.js').PdfMetadata, header?: PageDecoration|null, footer?: PageDecoration|null}} opts
 * @returns {Promise<Uint8Array>}
 */
export function buildPdf(body: import("./walker/walk.js").WalkResult, geo: PageGeometry, opts: {
    compress: boolean;
    metadata?: import("./index.js").PdfMetadata;
    header?: PageDecoration | null;
    footer?: PageDecoration | null;
}): Promise<Uint8Array>;
export type PageGeometry = {
    /**
     * pt
     */
    width: number;
    /**
     * pt
     */
    height: number;
    /**
     * pt  上余白
     */
    top: number;
    /**
     * pt
     */
    right: number;
    /**
     * pt  下余白
     */
    bottom: number;
    /**
     * pt
     */
    left: number;
};
/**
 * ヘッダー／フッター（ページごとに描画済みの走査結果）
 */
export type PageDecoration = {
    heightPx: number;
    render: (pageNumber: number, totalPages: number) => Promise<import("./walker/walk.js").WalkResult>;
};
