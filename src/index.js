// @ts-check
/**
 * Receipt html to pdf — 公開 API
 *
 * ブラウザ内で HTML/CSS をテキスト選択可能なベクター PDF に変換する。
 * 設計書: docs/design.md
 */
import { FontRegistry } from './font/registry.js';
import { renderDocument } from './renderer.js';
import { walk } from './walker/walk.js';
import { resolvePage, buildPdf } from './page.js';
import { PX_TO_PT } from './units.js';
import { createPacer } from './pacer.js';

export { expandPrintMediaCss } from './renderer.js';

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
 * 変換の進み具合。長い文書で進捗表示を出すために使う。
 *
 * @typedef {object} ConversionProgress
 * @property {'render'|'walk'|'layout'|'page'|'done'} phase
 * @property {number} [page]        phase が 'page' のときの 1 始まりのページ番号
 * @property {number} [totalPages]  phase が 'layout' 以降で確定する総ページ数
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
 * @property {(progress: ConversionProgress) => void} [onProgress]  進捗通知。長い文書では途中でイベントループへ戻すので、UI を更新できる
 */

/**
 * 変換の入力。DOM 要素、または HTML 文字列。
 * @typedef {Element|string} ConvertInput
 */

/** ライブラリのバージョン（package.json と同期） */
export const version = '0.3.0';

/** モジュール共有のフォントレジストリ */
const registry = new FontRegistry();

/**
 * フォントを登録する。同じ family/weight/style を再登録した場合は上書きする。
 * パース結果はモジュール内にキャッシュされ、以降の htmlToPdf 呼び出しで再利用される。
 *
 * @param {FontSource} font
 * @returns {Promise<void>}
 */
export async function registerFont(font) {
  if (!font || !font.family || !font.src) throw new TypeError('registerFont: { family, src } are required');
  const entry = await registry.register(font);
  if (entry.parsed.variable) {
    console.warn(
      `[receipt-html-to-pdf] "${font.family}" is a variable font; only the default instance outlines are embedded. ` +
        'Use static TTF instances for other weights.',
    );
  }
}

/**
 * 登録済みフォントの一覧（デバッグ用）。
 * @returns {{family: string, weight: number, style: string, glyphs: number}[]}
 */
export function listFonts() {
  return registry.fonts.map((f) => ({ family: f.displayFamily, weight: f.weight, style: f.style, glyphs: f.parsed.numGlyphs }));
}

/**
 * HTML を PDF に変換する。
 *
 * @param {ConvertInput} input
 * @param {ConvertOptions} [options]
 * @returns {Promise<Blob|Uint8Array|string>} options.output に応じた PDF
 */
export async function htmlToPdf(input, options = {}) {
  if (typeof document === 'undefined') throw new Error('htmlToPdf must run in a browser (needs DOM layout)');
  if (registry.fonts.length === 0) {
    throw new Error('htmlToPdf: no fonts registered. Call registerFont() with at least one TrueType font first.');
  }
  const warn = options.onWarning ?? (() => {});
  const progress = options.onProgress ?? (() => {});
  // 長い変換でメインスレッドを占有しないよう、一定時間ごとにイベントループへ戻す
  const pacer = createPacer();
  const geo = resolvePage(options.page);
  const widthPx = (geo.width - geo.left - geo.right) / PX_TO_PT;

  progress({ phase: 'render' });
  const rendered = await renderDocument(input, {
    widthPx,
    stylesheets: options.stylesheets ?? 'inherit',
    mediaPrint: options.mediaPrint ?? false,
    baseUrl: options.baseUrl,
    warn,
  });

  /** @type {import('./walker/walk.js').WalkContext} */
  const walkCtx = {
    registry,
    fontFallback: options.fontFallback ?? [],
    warn,
    textMeasure: options.textMeasure ?? 'auto',
    pacer,
  };
  const renderOpts = {
    widthPx,
    stylesheets: options.stylesheets ?? 'inherit',
    mediaPrint: options.mediaPrint ?? false,
    baseUrl: options.baseUrl,
    warn,
  };

  try {
    progress({ phase: 'walk' });
    const body = await walk(rendered.root, walkCtx);
    const header = options.header ? await makeDecoration(options.header, renderOpts, walkCtx) : null;
    const footer = options.footer ? await makeDecoration(options.footer, renderOpts, walkCtx) : null;
    const bytes = await buildPdf(body, geo, {
      compress: options.compress ?? true,
      metadata: options.metadata,
      header,
      footer,
      pacer,
      progress,
      warn,
    });
    progress({ phase: 'done' });
    return toOutput(bytes, options.output ?? 'blob');
  } finally {
    rendered.destroy();
  }
}

/**
 * ヘッダー／フッターのテンプレートを描画する準備をする。
 * 高さは 1 ページ目相当（{{pageNumber}} = {{totalPages}} = 1）で測り、全ページ同じとみなす。
 * @param {string} template
 * @param {Parameters<typeof renderDocument>[1]} renderOpts
 * @param {import('./walker/walk.js').WalkContext} walkCtx
 * @returns {Promise<import('./page.js').PageDecoration>}
 */
async function makeDecoration(template, renderOpts, walkCtx) {
  const renderOnce = async (/** @type {number} */ page, /** @type {number} */ total) => {
    const html = template.replace(/\{\{\s*pageNumber\s*\}\}/g, String(page)).replace(/\{\{\s*totalPages\s*\}\}/g, String(total));
    const rendered = await renderDocument(html, renderOpts);
    try {
      return await walk(rendered.root, walkCtx);
    } finally {
      rendered.destroy();
    }
  };
  const probe = await renderOnce(1, 1);
  /** @type {Map<string, import('./walker/walk.js').WalkResult>} */
  const cache = new Map([['1/1', probe]]);
  return {
    heightPx: probe.height,
    render: async (page, total) => {
      const key = `${page}/${total}`;
      let r = cache.get(key);
      if (!r) {
        r = await renderOnce(page, total);
        cache.set(key, r);
      }
      return r;
    },
  };
}

/**
 * @param {Uint8Array} bytes
 * @param {'blob'|'uint8array'|'dataurl'} output
 * @returns {Blob|Uint8Array|string}
 */
function toOutput(bytes, output) {
  if (output === 'uint8array') return bytes;
  if (output === 'dataurl') {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return 'data:application/pdf;base64,' + btoa(bin);
  }
  return new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)], { type: 'application/pdf' });
}

/**
 * 生成した PDF をブラウザでダウンロードさせる補助関数。
 *
 * @param {Blob|Uint8Array} pdf
 * @param {string} filename
 * @returns {void}
 */
export function downloadPdf(pdf, filename) {
  const blob =
    pdf instanceof Blob
      ? pdf
      : new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (pdf)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
