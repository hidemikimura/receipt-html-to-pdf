// @ts-check
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
export async function renderDocument(input, opts) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${opts.widthPx}px;height:1000px;border:0;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) throw new Error('Failed to create rendering iframe');

  const html = buildHtml(input, opts);
  doc.open();
  doc.write(html);
  doc.close();

  // 宣言的シャドウ DOM で復元した要素はアップグレードされないため :defined がマッチしない。
  // 中身の無いスタブを定義してマッチさせる（描画には影響しない）。
  defineStubElements(doc, win);

  // 高さを内容に合わせる（スクロールが発生しないようにする）
  const fit = () => {
    iframe.style.height = `${Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 100)}px`;
  };
  fit();

  await waitForStylesheets(doc);
  fit();
  await waitForFonts(doc);
  await waitForImages(doc);
  materializePseudoElements(doc, opts.warn ?? (() => {}));
  fit();
  // レイアウトを確定させる
  void doc.body.offsetHeight;
  warnIfTooWide(doc, opts.widthPx, opts.warn ?? (() => {}));

  return {
    iframe,
    doc,
    win,
    root: doc.body,
    destroy: () => iframe.remove(),
  };
}

/**
 * @param {import('./index.js').ConvertInput} input
 * @param {{stylesheets: 'inherit'|'none'|string[], mediaPrint: boolean, baseUrl?: string, warn?: (w: import('./index.js').ConversionWarning) => void}} opts
 * @returns {string}
 */
function buildHtml(input, opts) {
  const baseUrl = opts.baseUrl ?? document.baseURI;
  const base = `<base href="${escapeAttr(baseUrl)}">`;
  // 親文書の body マージンが PDF に持ち込まれると内容が右へずれて右端が切れるので、
  // !important で確実に打ち消す（用紙の余白は options.page.margin が受け持つ）。
  const reset = `<style data-rhtp-reset>html,body{margin:0 !important;padding:0 !important;background:transparent}html{-webkit-text-size-adjust:100%}</style>`;

  if (typeof input === 'string') {
    // 完全な HTML 文書ならそのまま。<head> の直後に base とリセットを差し込む。
    if (/<html[\s>]/i.test(input)) {
      let html = input;
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => `${m}${base}${reset}`)
        : html.replace(/<html[^>]*>/i, (m) => `${m}<head>${base}${reset}</head>`);
      return opts.mediaPrint ? expandPrintMedia(html) : html;
    }
    const styles = collectStyles(opts.stylesheets, opts.mediaPrint);
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${base}${reset}${styles}</head><body>${input}</body></html>`;
  }

  // 要素: outerHTML と親文書のスタイルを持ち込む。
  // <html> / <body> の属性（class, lang, data-* …）も写し、`body.reissue .x` のような祖先依存のセレクタを効かせる。
  const styles = collectStyles(opts.stylesheets, opts.mediaPrint) + shadowHostStyles(input, opts.stylesheets, opts.mediaPrint);
  const htmlAttrs = copyAttrs(document.documentElement);
  const bodyAttrs = copyAttrs(document.body);
  const body = serializeElement(input, opts.warn ?? (() => {}));
  return `<!DOCTYPE html><html${htmlAttrs}><head><meta charset="utf-8">${base}${reset}${styles}</head><body${bodyAttrs}>${body}</body></html>`;
}

/**
 * @param {'inherit'|'none'|string[]} stylesheets
 * @param {boolean} mediaPrint
 * @returns {string}
 */
function collectStyles(stylesheets, mediaPrint) {
  if (stylesheets === 'none') return '';
  /** @type {string[]} */
  const parts = [];
  if (stylesheets === 'inherit') {
    for (const el of document.querySelectorAll('style, link[rel~="stylesheet"]')) {
      if (el.hasAttribute('data-rhtp-reset')) continue;
      if (el instanceof HTMLStyleElement) {
        const css = el.textContent ?? '';
        parts.push(`<style>${mediaPrint ? expandPrintMediaCss(css) : css}</style>`);
      } else if (el instanceof HTMLLinkElement) {
        parts.push(`<link rel="stylesheet" href="${escapeAttr(el.href)}"${el.media ? ` media="${escapeAttr(el.media)}"` : ''}>`);
      }
    }
    // document.adoptedStyleSheets（CSSOM で組み立てたスタイル）は <style> に出てこないので取り出す
    const adopted = cssTextOf(document.adoptedStyleSheets);
    if (adopted) parts.push(`<style>${mediaPrint ? expandPrintMediaCss(adopted) : adopted}</style>`);
    return parts.join('');
  }
  for (const s of stylesheets) {
    if (/^(https?:)?\/\/|^\.{0,2}\/|\.css(\?|$)/i.test(s) && !s.includes('{')) {
      parts.push(`<link rel="stylesheet" href="${escapeAttr(s)}">`);
    } else {
      parts.push(`<style>${mediaPrint ? expandPrintMediaCss(s) : s}</style>`);
    }
  }
  return parts.join('');
}

/**
 * シャドウツリーの中の要素を渡されたとき、その要素が属するシャドウルート
 * （およびその外側のシャドウルート）のスタイルを取り出す。
 * 文書のスタイルシートはシャドウツリーに届かないため、`stylesheets: 'inherit'` では拾えない。
 *
 * @param {Element} input
 * @param {'inherit'|'none'|string[]} stylesheets
 * @param {boolean} mediaPrint
 * @returns {string}
 */
function shadowHostStyles(input, stylesheets, mediaPrint) {
  if (stylesheets !== 'inherit') return '';
  /** @type {string[]} */
  const parts = [];
  let node = /** @type {Node|null} */ (input.getRootNode());
  // 内側のツリーから順に集め、外側ほど先（優先度が低い位置）に置く
  while (node && node !== document && 'host' in node) {
    const root = /** @type {ShadowRoot} */ (node);
    const css = [...root.querySelectorAll('style')].map((el) => el.textContent ?? '').join('\n') + '\n' + cssTextOf(root.adoptedStyleSheets);
    if (css.trim()) parts.unshift(css);
    node = root.host.getRootNode();
  }
  return parts.map((css) => `<style>${mediaPrint ? expandPrintMediaCss(css) : css}</style>`).join('');
}

/**
 * 内容が本文領域より横に広いと、右側が切れたまま気づかれにくいので警告する。
 * 固定幅 + `box-sizing: content-box` や、畳めない表が原因になりやすい。
 *
 * @param {Document} doc
 * @param {number} widthPx  本文領域の幅（px）
 * @param {(w: import('./index.js').ConversionWarning) => void} warn
 */
function warnIfTooWide(doc, widthPx, warn) {
  const width = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth);
  const over = width - widthPx;
  // 1px 未満は丸め誤差とみなす
  if (over < 1) return;
  const mm = (/** @type {number} */ px) => Math.round((px / 96) * 25.4 * 10) / 10;
  warn({
    code: 'other',
    message:
      `Content is ${Math.round(over)}px (${mm(over)}mm) wider than the page content area ` +
      `(${Math.round(width)}px vs ${Math.round(widthPx)}px); the right side will be clipped. ` +
      'Common causes: a fixed width plus padding/border without box-sizing: border-box, or a table that cannot shrink.',
  });
}

/** シャドウルートを持てない要素（void 要素）。outerHTML にフォールバックする。 */
const VOID_TAGS = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR']);

/**
 * 要素を outerHTML 相当の文字列にする。開いているシャドウルートは
 * `<template shadowrootmode>`（宣言的シャドウ DOM）として一緒に直列化し、
 * iframe 側のパーサに本物の ShadowRoot として復元させる。
 *
 * `adoptedStyleSheets` は直列化されないので、一時的に `<style>` として差し込んでから直列化する
 * （同期処理のうちに元へ戻すので画面には影響しない）。
 *
 * @param {Element} input
 * @param {(w: import('./index.js').ConversionWarning) => void} warn
 * @returns {string}
 */
function serializeElement(input, warn) {
  const whole = input === document.body || input === document.documentElement;
  const roots = collectShadowRoots(whole ? document.body : input);
  if (!roots.length) return whole ? document.body.innerHTML : input.outerHTML;

  const host = whole ? document.body : input;
  if (typeof (/** @type {any} */ (host).getHTML) !== 'function') {
    warn({
      code: 'unsupported-css',
      message:
        'This browser lacks Element.getHTML(); shadow DOM content cannot be serialized and will be missing from the PDF. ' +
        'Pass an element inside the shadow root instead.',
      element: input,
    });
    return whole ? document.body.innerHTML : input.outerHTML;
  }

  const restore = inlineAdoptedStyleSheets(roots);
  try {
    const opts = { serializableShadowRoots: true, shadowRoots: roots };
    const inner = /** @type {string} */ (/** @type {any} */ (host).getHTML(opts));
    if (whole) return inner;
    const tag = input.tagName.toLowerCase();
    // void 要素はシャドウルートも子も持たないので通常の outerHTML でよい
    if (VOID_TAGS.has(input.tagName)) return input.outerHTML;
    return `<${tag}${copyAttrs(input)}>${inner}</${tag}>`;
  } finally {
    restore();
  }
}

/**
 * root 以下（シャドウツリーの中も含む）の open なシャドウルートを集める。
 * closed なシャドウルートは参照できないため対象外。
 * @param {Element|ShadowRoot} root
 * @returns {ShadowRoot[]}
 */
function collectShadowRoots(root) {
  /** @type {ShadowRoot[]} */
  const out = [];
  /** @param {Element|ShadowRoot} node */
  const walk = (node) => {
    if (node instanceof Element && node.shadowRoot) {
      out.push(node.shadowRoot);
      walk(node.shadowRoot);
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/**
 * 各シャドウルートの adoptedStyleSheets を一時的に `<style>` として差し込む。
 * 戻り値を呼ぶと取り除く。
 * @param {ShadowRoot[]} roots
 * @returns {() => void}
 */
function inlineAdoptedStyleSheets(roots) {
  /** @type {HTMLStyleElement[]} */
  const added = [];
  for (const root of roots) {
    const css = cssTextOf(root.adoptedStyleSheets);
    if (!css) continue;
    const style = document.createElement('style');
    style.setAttribute('data-rhtp-adopted', '');
    style.textContent = css;
    root.insertBefore(style, root.firstChild);
    added.push(style);
  }
  return () => {
    for (const style of added) style.remove();
  };
}

/**
 * CSSStyleSheet の配列を CSS テキストにする。読めないもの（クロスオリジン）は飛ばす。
 * @param {readonly CSSStyleSheet[]|undefined} sheets
 * @returns {string}
 */
function cssTextOf(sheets) {
  if (!sheets || !sheets.length) return '';
  const parts = [];
  for (const sheet of sheets) {
    try {
      for (const rule of sheet.cssRules) parts.push(rule.cssText);
    } catch {
      // クロスオリジンのスタイルシートは読めない
    }
  }
  return parts.join('\n');
}

/**
 * iframe 内に、文書に出てくるカスタム要素名の空のスタブを定義する。
 * これをしないと要素が未定義のままで `:defined` がマッチせず、既定の `display: inline` で組まれてしまう。
 * @param {Document} doc
 * @param {Window} win
 */
function defineStubElements(doc, win) {
  const registry = /** @type {CustomElementRegistry|undefined} */ (/** @type {any} */ (win).customElements);
  const Base = /** @type {typeof HTMLElement|undefined} */ (/** @type {any} */ (win).HTMLElement);
  if (!registry || !Base) return;
  /** @type {Set<string>} */
  const names = new Set();
  /** @param {ParentNode} node */
  const scan = (node) => {
    for (const el of node.querySelectorAll('*')) {
      // `is=` によるカスタマイズド組み込み要素は対象外（定義に extends が必要なため）
      if (el.tagName.includes('-') && !el.hasAttribute('is')) names.add(el.tagName.toLowerCase());
      if (el.shadowRoot) scan(el.shadowRoot);
    }
  };
  scan(doc);
  for (const name of names) {
    if (registry.get(name)) continue;
    try {
      registry.define(name, class extends Base {});
    } catch {
      // 不正な名前などは無視する
    }
  }
}

/**
 * HTML 文字列中の <style> 内の @media print を展開する。
 * @param {string} html
 */
function expandPrintMedia(html) {
  return html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs, css) => `<style${attrs}>${expandPrintMediaCss(css)}</style>`);
}

/**
 * `@media print { ... }` ブロックを通常ルールとして展開し、`@media screen { ... }` を除去する。
 * 単純な括弧の対応で処理する（ネストした @media は想定しない）。
 * @param {string} css
 * @returns {string}
 */
export function expandPrintMediaCss(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const m = /@media\s*([^{]+)\{/g;
    m.lastIndex = i;
    const hit = m.exec(css);
    if (!hit) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, hit.index);
    // ブロックの終わりを探す
    let depth = 1;
    let j = m.lastIndex;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const query = /** @type {string} */ (hit[1]).trim();
    const body = css.slice(m.lastIndex, j - 1);
    if (/\bprint\b/.test(query)) out += body;
    else if (/^\s*(only\s+)?screen\b/.test(query) && !/\band\b/.test(query)) out += '';
    else out += css.slice(hit.index, j);
    i = j;
  }
  return out;
}

/**
 * 要素の属性を ` name="value"` の並びにする（イベントハンドラ属性は除く）。
 * @param {Element} el
 */
function copyAttrs(el) {
  let out = '';
  for (const a of el.attributes) {
    if (/^on/i.test(a.name)) continue;
    out += ` ${a.name}="${escapeAttr(a.value)}"`;
  }
  return out;
}

/** @param {string} s */
function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** @param {Document} doc */
async function waitForStylesheets(doc) {
  const links = [...doc.querySelectorAll('link[rel~="stylesheet"]')];
  await Promise.all(
    links.map(
      (l) =>
        new Promise((resolve) => {
          const link = /** @type {HTMLLinkElement} */ (l);
          if (link.sheet) return resolve(undefined);
          link.addEventListener('load', () => resolve(undefined), { once: true });
          link.addEventListener('error', () => resolve(undefined), { once: true });
          setTimeout(() => resolve(undefined), 10000);
        }),
    ),
  );
}

/** @param {Document} doc */
async function waitForFonts(doc) {
  // 使用中のフォント読み込みを起動させるためにレイアウトを強制
  void doc.body.offsetHeight;
  if (doc.fonts) {
    await doc.fonts.ready;
    // ready 後に新たに読み込みが始まることがあるので、loading 状態のものを待つ
    const loading = [...doc.fonts].filter((f) => f.status === 'loading').map((f) => f.loaded.catch(() => undefined));
    if (loading.length) await Promise.all(loading);
    await doc.fonts.ready;
  }
}

/** @param {Document} doc */
async function waitForImages(doc) {
  const imgs = [...doc.images];
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? img.decode().catch(() => undefined)
        : new Promise((resolve) => {
            img.addEventListener('load', () => img.decode().catch(() => undefined).then(resolve), { once: true });
            img.addEventListener('error', () => resolve(undefined), { once: true });
            setTimeout(() => resolve(undefined), 10000);
          }),
    ),
  );
}

/**
 * ::before / ::after を実体の <span> に置き換える。
 * 擬似要素は DOM ノードを持たず Range で計測できないため、computed style をすべて写した span を
 * 同じ位置に挿入し、元の擬似要素は content: none で消す。文字列 content のみ対応（counter / url は警告）。
 * @param {Document} doc
 * @param {(w: import('./index.js').ConversionWarning) => void} warn
 */
export function materializePseudoElements(doc, warn) {
  const win = doc.defaultView;
  if (!win) return;
  /** @type {{el: Element, pseudo: 'before'|'after', text: string, styles: [string, string][]}[]} */
  const jobs = [];
  for (const el of deepQueryAll(doc.body)) {
    for (const pseudo of /** @type {('before'|'after')[]} */ (['before', 'after'])) {
      const ps = win.getComputedStyle(el, `::${pseudo}`);
      const content = ps.content;
      if (!content || content === 'none' || content === 'normal' || ps.display === 'none') continue;
      const text = parseContentString(content);
      if (text === null) {
        warn({
          code: 'unsupported-css',
          message: `::${pseudo} content "${content}" is not supported (only quoted strings are); the pseudo-element is skipped`,
          element: el,
          property: 'content',
        });
        continue;
      }
      /** @type {[string, string][]} */
      const styles = [];
      for (let i = 0; i < ps.length; i++) {
        const prop = /** @type {string} */ (ps[i]);
        if (prop === 'content' || prop.startsWith('-webkit-') || prop.startsWith('-moz-')) continue;
        styles.push([prop, ps.getPropertyValue(prop)]);
      }
      jobs.push({ el, pseudo, text, styles });
    }
  }
  if (!jobs.length) return;

  const disableCss =
    '[data-rhtp-pseudo-host~="before"]::before{content:none!important;display:none!important}' +
    '[data-rhtp-pseudo-host~="after"]::after{content:none!important;display:none!important}';
  const style = doc.createElement('style');
  style.setAttribute('data-rhtp-pseudo', '');
  style.textContent = disableCss;
  doc.head.appendChild(style);
  // 文書のスタイルはシャドウツリーに届かないので、対象を含むシャドウルートにも同じ規則を入れる
  for (const root of new Set(jobs.map((j) => j.el.getRootNode()).filter((r) => r !== doc))) {
    const inner = doc.createElement('style');
    inner.setAttribute('data-rhtp-pseudo', '');
    inner.textContent = disableCss;
    /** @type {ShadowRoot} */ (root).appendChild(inner);
  }

  for (const job of jobs) {
    const span = doc.createElement('span');
    span.setAttribute('data-rhtp-pseudo', job.pseudo);
    for (const [prop, value] of job.styles) span.style.setProperty(prop, value);
    span.textContent = job.text;
    const hosts = (job.el.getAttribute('data-rhtp-pseudo-host') ?? '').split(' ').filter(Boolean);
    hosts.push(job.pseudo);
    job.el.setAttribute('data-rhtp-pseudo-host', hosts.join(' '));
    if (job.pseudo === 'before') job.el.insertBefore(span, job.el.firstChild);
    else job.el.appendChild(span);
  }
}

/**
 * root 以下のすべての要素を、シャドウツリーの中も含めて列挙する。
 * @param {Element|ShadowRoot} root
 * @returns {Element[]}
 */
function deepQueryAll(root) {
  /** @type {Element[]} */
  const out = [];
  /** @param {Element|ShadowRoot} node */
  const walk = (node) => {
    for (const el of node.querySelectorAll('*')) {
      out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

/**
 * computed content 値（'"※ "' / '"a" "b"' / 'counter(x)' …）から文字列を取り出す。
 * 文字列以外のトークンが含まれる場合は null。
 * @param {string} value
 * @returns {string|null}
 */
export function parseContentString(value) {
  let out = '';
  let i = 0;
  const v = value.trim();
  while (i < v.length) {
    const ch = v[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch !== '"' && ch !== "'") return null;
    const quote = ch;
    i++;
    while (i < v.length && v[i] !== quote) {
      if (v[i] === '\\') {
        i++;
        const hex = /^[0-9a-fA-F]{1,6}/.exec(v.slice(i));
        if (hex) {
          out += String.fromCodePoint(parseInt(hex[0], 16));
          i += hex[0].length;
          if (v[i] === ' ') i++;
        } else {
          out += v[i] ?? '';
          i++;
        }
      } else {
        out += v[i];
        i++;
      }
    }
    i++; // closing quote
  }
  return out;
}
