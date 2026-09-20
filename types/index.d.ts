/**
 * フォントを登録する。同じ family/weight/style を再登録した場合は上書きする。
 * パース結果はモジュール内にキャッシュされ、以降の htmlToPdf 呼び出しで再利用される。
 *
 * @param {FontSource} font
 * @returns {Promise<void>}
 */
export function registerFont(font: FontSource): Promise<void>;
/**
 * 登録済みフォントの一覧（デバッグ用）。
 * @returns {{family: string, weight: number, style: string, glyphs: number}[]}
 */
export function listFonts(): {
    family: string;
    weight: number;
    style: string;
    glyphs: number;
}[];
/**
 * HTML を PDF に変換する。
 *
 * @param {ConvertInput} input
 * @param {ConvertOptions} [options]
 * @returns {Promise<Blob|Uint8Array|string>} options.output に応じた PDF
 */
export function htmlToPdf(input: ConvertInput, options?: ConvertOptions): Promise<Blob | Uint8Array | string>;
/**
 * 生成した PDF をブラウザでダウンロードさせる補助関数。
 *
 * @param {Blob|Uint8Array} pdf
 * @param {string} filename
 * @returns {void}
 */
export function downloadPdf(pdf: Blob | Uint8Array, filename: string): void;
export { expandPrintMediaCss } from "./renderer.js";
/**
 * 登録するフォントの定義。
 * `src` は TrueType アウトライン（glyf）を持つ静的 TTF のみ対応。
 *
 * @typedef {object} FontSource
 * @property {string} family        CSS の font-family と一致させる名前
 * @property {number} [weight=400]  100〜900
 * @property {'normal'|'italic'} [style='normal']
 * @property {string|ArrayBuffer|Uint8Array} src  URL または フォントファイルのバイト列
 */
/**
 * 用紙サイズ。既定名か、幅・高さを CSS 長さ（'80mm' など）で指定する。
 *
 * @typedef {'A3'|'A4'|'A5'|'B4'|'B5'|'Letter'|'Legal'|{width: string, height: string}} PageSize
 */
/**
 * @typedef {object} PageOptions
 * @property {PageSize} [size='A4']
 * @property {'portrait'|'landscape'} [orientation='portrait']
 * @property {string|{top: string, right: string, bottom: string, left: string}} [margin='15mm']
 */
/**
 * @typedef {object} PdfMetadata
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string} [keywords]
 * @property {string} [creator]
 * @property {Date}   [creationDate]
 */
/**
 * 変換中に発生した非致命的な問題。例外にはせず onWarning に流す。
 *
 * @typedef {object} ConversionWarning
 * @property {'unsupported-css'|'missing-font'|'missing-glyph'|'image-failed'|'other'} code
 * @property {string} message
 * @property {Element} [element]
 * @property {string} [property]   unsupported-css のときの CSS プロパティ名
 * @property {string} [text]       missing-glyph のときの該当文字
 */
/**
 * @typedef {object} ConvertOptions
 * @property {PageOptions} [page]
 * @property {string[]} [fontFallback]           未登録ファミリーが要求されたときに試す family の順序
 * @property {'inherit'|'none'|string[]} [stylesheets='inherit']  親文書のスタイルを継承するか、URL/CSS テキストを明示するか
 * @property {boolean} [mediaPrint=false]        `@media print` ルールを通常ルールとして適用する
 * @property {boolean} [compress=true]           CompressionStream が使えれば FlateDecode を適用する
 * @property {PdfMetadata} [metadata]
 * @property {string|null} [header=null]         各ページ上部の HTML テンプレート。{{pageNumber}} {{totalPages}} を置換する
 * @property {string|null} [footer=null]         各ページ下部の HTML テンプレート。同上
 * @property {'font'|'measure'|'auto'} [textMeasure='auto']  グリフ位置の決め方（現在は常に実測）
 * @property {'blob'|'uint8array'|'dataurl'} [output='blob']
 * @property {string} [baseUrl]                  相対 URL（フォント・画像）の基準。既定は現在の文書
 * @property {(warning: ConversionWarning) => void} [onWarning]
 */
/**
 * 変換の入力。DOM 要素、または HTML 文字列。
 * @typedef {Element|string} ConvertInput
 */
/** ライブラリのバージョン（package.json と同期） */
export const version: "0.2.0";
/**
 * 登録するフォントの定義。
 * `src` は TrueType アウトライン（glyf）を持つ静的 TTF のみ対応。
 */
export type FontSource = {
    /**
     * CSS の font-family と一致させる名前
     */
    family: string;
    /**
     * 100〜900
     */
    weight?: number | undefined;
    style?: "normal" | "italic" | undefined;
    /**
     * URL または フォントファイルのバイト列
     */
    src: string | ArrayBuffer | Uint8Array;
};
/**
 * 用紙サイズ。既定名か、幅・高さを CSS 長さ（'80mm' など）で指定する。
 */
export type PageSize = "A3" | "A4" | "A5" | "B4" | "B5" | "Letter" | "Legal" | {
    width: string;
    height: string;
};
export type PageOptions = {
    size?: PageSize | undefined;
    orientation?: "portrait" | "landscape" | undefined;
    margin?: string | {
        top: string;
        right: string;
        bottom: string;
        left: string;
    } | undefined;
};
export type PdfMetadata = {
    title?: string | undefined;
    author?: string | undefined;
    subject?: string | undefined;
    keywords?: string | undefined;
    creator?: string | undefined;
    creationDate?: Date | undefined;
};
/**
 * 変換中に発生した非致命的な問題。例外にはせず onWarning に流す。
 */
export type ConversionWarning = {
    code: "unsupported-css" | "missing-font" | "missing-glyph" | "image-failed" | "other";
    message: string;
    element?: Element | undefined;
    /**
     * unsupported-css のときの CSS プロパティ名
     */
    property?: string | undefined;
    /**
     * missing-glyph のときの該当文字
     */
    text?: string | undefined;
};
export type ConvertOptions = {
    page?: PageOptions | undefined;
    /**
     * 未登録ファミリーが要求されたときに試す family の順序
     */
    fontFallback?: string[] | undefined;
    /**
     * 親文書のスタイルを継承するか、URL/CSS テキストを明示するか
     */
    stylesheets?: string[] | "inherit" | "none" | undefined;
    /**
     * `@media print` ルールを通常ルールとして適用する
     */
    mediaPrint?: boolean | undefined;
    /**
     * CompressionStream が使えれば FlateDecode を適用する
     */
    compress?: boolean | undefined;
    metadata?: PdfMetadata | undefined;
    /**
     * 各ページ上部の HTML テンプレート。{{pageNumber}} {{totalPages}} を置換する
     */
    header?: string | null | undefined;
    /**
     * 各ページ下部の HTML テンプレート。同上
     */
    footer?: string | null | undefined;
    /**
     * グリフ位置の決め方（現在は常に実測）
     */
    textMeasure?: "font" | "measure" | "auto" | undefined;
    output?: "blob" | "uint8array" | "dataurl" | undefined;
    /**
     * 相対 URL（フォント・画像）の基準。既定は現在の文書
     */
    baseUrl?: string | undefined;
    onWarning?: ((warning: ConversionWarning) => void) | undefined;
};
/**
 * 変換の入力。DOM 要素、または HTML 文字列。
 */
export type ConvertInput = Element | string;
