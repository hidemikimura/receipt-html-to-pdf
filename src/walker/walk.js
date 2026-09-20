// @ts-check
/**
 * DOM Walker — ブラウザがレイアウトした Document を走査し、DisplayList（描画命令の配列）を作る。
 * 座標はすべて CSS px、iframe ドキュメント座標（左上原点、y 下向き）。
 */
import { parseColor, cssPx } from '../units.js';
import { splitFamilies, parseWeight } from '../font/registry.js';
import { measureText } from './text.js';
import { featureTagsOf } from '../font/gsub.js';
import { loadImage, parseBackgroundUrl, fitImage, objectFitToSize, splitRepeat, tileAxis } from './image.js';
import { parseLinearGradient } from './gradient.js';
import { shapeToPath } from './svg-path.js';

/**
 * @typedef {import('../units.js').Rgba} Rgba
 * @typedef {[number, number, number, number]} Radius  [左上, 右上, 右下, 左下] px
 * @typedef {{x: number, y: number, w: number, h: number, radius?: Radius}} Box
 *
 * @typedef {{type: 'rect', x: number, y: number, w: number, h: number, color: Rgba, radius?: Radius, z: number, seq: number}} RectItem
 * @typedef {{type: 'line', x1: number, y1: number, x2: number, y2: number, width: number, color: Rgba, dash: number[]|null, z: number, seq: number}} LineItem
 * @typedef {{type: 'stroke-rrect', x: number, y: number, w: number, h: number, radius: Radius, width: number, color: Rgba, dash: number[]|null, z: number, seq: number}} StrokeRRectItem
 * @typedef {{type: 'image', x: number, y: number, w: number, h: number, image: import('./image.js').DecodedImage, clip: Box|null, alpha: number, z: number, seq: number}} ImageItem
 * @typedef {{gid: number, cp: number, x: number, advance: number}} Glyph  advance は px
 * @typedef {{type: 'text', x: number, y: number, top: number, bottom: number, size: number, color: Rgba, font: import('../font/registry.js').RegisteredFont, glyphs: Glyph[], z: number, seq: number}} TextItem
 * @typedef {{type: 'group', matrix: [number, number, number, number, number, number], origin: {x: number, y: number}, items: DisplayItem[], top: number, bottom: number, z: number, seq: number}} GroupItem
 * @typedef {{type: 'clip', box: Box, items: DisplayItem[], top: number, bottom: number, z: number, seq: number}} ClipItem  overflow: hidden
 * @typedef {{type: 'gradient', box: Box, clip: Box, gradient: import('./gradient.js').LinearGradient, alpha: number, z: number, seq: number}} GradientItem  linear-gradient（box はグラデーションの基準領域、clip は描画範囲）
 * @typedef {{color: Rgba, width: number, cap: 0|1|2, join: 0|1|2, miter: number, dash: number[]|null, dashOffset: number}} PathStroke
 * @typedef {{type: 'path', segs: import('./svg-path.js').PathSeg[], matrix: [number, number, number, number, number, number], fill: Rgba|null, evenOdd: boolean, stroke: PathStroke|null, top: number, bottom: number, z: number, seq: number}} PathItem  インライン SVG の図形（matrix はユーザー単位 → ドキュメント px）
 * @typedef {RectItem|LineItem|StrokeRRectItem|ImageItem|TextItem|GroupItem|ClipItem|GradientItem|PathItem} DisplayItem
 *
 * @typedef {{top: number, bottom: number}} Atom  ページ境界を跨いではいけない縦範囲（行・表の行・画像・break-inside: avoid）
 * @typedef {{top: number, bottom: number, headTop: number, headBottom: number, headItems: DisplayItem[], footTop: number, footBottom: number, footItems: DisplayItem[]}} TableInfo
 * @typedef {{start: number, end: number, pullTo: number}} Join  break-before/after: avoid — [start, end] に境界を置かず、置きそうなら pullTo まで戻す
 * @typedef {{x: number, y: number, w: number, h: number, href: string, fragment: string|null}} LinkRect  <a href> の 1 行ぶんの当たり判定（ドキュメント px）
 * @typedef {{level: number, text: string, y: number}} Heading  しおり用の見出し
 * @typedef {{items: DisplayItem[], atoms: Atom[], breaks: number[], joins: Join[], tables: TableInfo[], links: LinkRect[], anchors: Map<string, number>, headings: Heading[], height: number}} WalkResult
 */

/**
 * @typedef {object} WalkContext
 * @property {import('../font/registry.js').FontRegistry} registry
 * @property {string[]} fontFallback
 * @property {(w: import('../index.js').ConversionWarning) => void} warn
 * @property {'font'|'measure'|'auto'} textMeasure
 * @property {import('../pacer.js').Pacer} [pacer]  長い走査で途中イベントループへ戻すための譲渡
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED']);

/** background-repeat で並べるタイルの上限。これを超えたら 1 枚だけ描いて警告する。 */
const MAX_BG_TILES = 4000;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 描画されない SVG 要素（定義や説明）。黙って飛ばす。 */
const SVG_NON_RENDERED = new Set(['defs', 'symbol', 'marker', 'clipPath', 'mask', 'pattern', 'filter', 'linearGradient', 'radialGradient', 'style', 'title', 'desc', 'metadata', 'script']);
/** 子をたどるだけの SVG 要素 */
const SVG_CONTAINERS = new Set(['g', 'a', 'svg', 'switch']);

/**
 * flat tree（シャドウ DOM を展開した木）での子ノードを返す。
 *
 * - シャドウホスト → シャドウルートの子（light DOM の子は `<slot>` 経由で現れる）
 * - `<slot>` → 割り当てられたノード（無ければフォールバック内容）
 * - それ以外 → 通常の子ノード
 *
 * @param {Element} el
 * @returns {ChildNode[]}
 */
function flatChildNodes(el) {
  const shadow = el.shadowRoot;
  if (shadow) return [...shadow.childNodes];
  if (el.tagName === 'SLOT') {
    const slot = /** @type {HTMLSlotElement} */ (/** @type {unknown} */ (el));
    if (typeof slot.assignedNodes === 'function') {
      return /** @type {ChildNode[]} */ (slot.assignedNodes({ flatten: true }));
    }
  }
  return [...el.childNodes];
}

/** 未対応 CSS プロパティ: [computedStyle のキー, 「指定されている」判定] */
const UNSUPPORTED = /** @type {[keyof CSSStyleDeclaration & string, (v: string) => boolean][]} */ ([
  ['boxShadow', (v) => v !== 'none'],
  ['textShadow', (v) => v !== 'none'],
  ['filter', (v) => v !== 'none'],
  ['backdropFilter', (v) => v !== 'none' && v !== ''],
  ['writingMode', (v) => v.startsWith('vertical')],
  ['outlineStyle', (v) => v !== 'none'],
  ['clipPath', (v) => v !== 'none'],
  ['mixBlendMode', (v) => v !== 'normal'],
]);

/**
 * @param {HTMLElement} root
 * @param {WalkContext} ctx
 * @returns {Promise<WalkResult>}
 */
export async function walk(root, ctx) {
  const win = /** @type {Window} */ (root.ownerDocument.defaultView);
  const sx = win.scrollX;
  const sy = win.scrollY;
  /** @type {DisplayItem[]} 現在の出力先（transform グループ内では差し替わる） */
  let out = [];
  const rootItems = out;
  /** @type {Atom[]} */
  const atoms = [];
  /** @type {number[]} */
  const breaks = [];
  /** @type {Join[]} */
  const joins = [];
  /** @type {LinkRect[]} */
  const links = [];
  /** @type {Map<string, number>} 文書内リンクの飛び先: id → ドキュメント y */
  const anchors = new Map();
  /** @type {Heading[]} */
  const headings = [];
  /** @type {TableInfo[]} */
  const tables = [];
  /** @type {TableInfo|null} 走査中のテーブル（thead の描画命令を記録する先） */
  let currentTable = null;
  let seq = 0;
  /** @type {Set<string>} */
  const warned = new Set();
  /** @type {Set<string>} */
  const missingFamilies = new Set();

  /**
   * @param {string} key
   * @param {import('../index.js').ConversionWarning} w
   */
  function warnOnce(key, w) {
    if (warned.has(key)) return;
    warned.add(key);
    ctx.warn(w);
  }

  /**
   * @typedef {{z: number, alpha: number, decorations: {line: string, color: Rgba}[]}} Inherited
   */

  /**
   * @param {Element} el
   * @param {Inherited} inherited
   */
  async function visit(el, inherited) {
    if (SKIP_TAGS.has(el.tagName)) return;
    if (ctx.pacer) await ctx.pacer();
    const style = win.getComputedStyle(el);
    if (style.display === 'none') return;

    // transform: 一時的に無効化して無変形の座標で走査し、グループとして包む
    const matrix = parseTransform(style.transform);
    // 注意: iframe 内の要素は親ウィンドウの HTMLElement の instanceof に失敗するので、タグ名・プロパティで判定する
    if (matrix && 'style' in el) {
      const hel = /** @type {HTMLElement} */ (el);
      const transformedRect = hel.getBoundingClientRect();
      const prev = hel.style.transform;
      hel.style.transform = 'none';
      void hel.offsetWidth;
      const plainRect = hel.getBoundingClientRect();
      const [ox, oy] = parseOrigin(style.transformOrigin);
      const origin = { x: plainRect.left + ox + sx, y: plainRect.top + oy + sy };

      const saved = out;
      out = [];
      await visitInner(el, win.getComputedStyle(el), inherited);
      const items = out;
      out = saved;
      hel.style.transform = prev;
      void hel.offsetWidth;

      out.push({
        type: 'group',
        matrix,
        origin,
        items,
        top: transformedRect.top + sy,
        bottom: transformedRect.bottom + sy,
        z: zOf(style, inherited.z),
        seq: seq++,
      });
      return;
    }
    await visitInner(el, style, inherited);
  }

  /** @param {CSSStyleDeclaration} style @param {number} inheritedZ */
  function zOf(style, inheritedZ) {
    if (style.position !== 'static' && style.zIndex !== 'auto') {
      const zi = parseInt(style.zIndex, 10);
      if (Number.isFinite(zi)) return zi;
    }
    return inheritedZ;
  }

  /**
   * @param {Element} el
   * @param {CSSStyleDeclaration} style
   * @param {Inherited} inherited
   */
  async function visitInner(el, style, inherited) {
    const z = zOf(style, inherited.z);
    const opacity = parseFloat(style.opacity);
    const alpha = inherited.alpha * (Number.isFinite(opacity) ? opacity : 1);
    const visible = style.visibility === 'visible' && alpha > 0;

    // ページ分割のヒント（非表示でも位置は持つので visible に関係なく集める）
    if (style.display !== 'contents' && style.display !== 'inline') {
      const r = el.getBoundingClientRect();
      const top = r.top + sy;
      const bottom = r.bottom + sy;
      if (r.height > 0) {
        const bb = style.breakBefore || style.pageBreakBefore;
        const ba = style.breakAfter || style.pageBreakAfter;
        if (/^(page|always|left|right|recto|verso)$/.test(bb)) breaks.push(top);
        if (/^(page|always|left|right|recto|verso)$/.test(ba)) breaks.push(bottom);
        const bi = style.breakInside || style.pageBreakInside;
        // 表の行・行グループ・画像・avoid 指定は分割しない
        if (bi === 'avoid' || bi === 'avoid-page' || style.display === 'table-row' || style.display === 'table-header-group' || style.display === 'table-footer-group' || el.tagName === 'IMG' || el.tagName === 'svg') {
          atoms.push({ top, bottom });
        }
        // break-before/after: avoid — 隣の箱との間にページ境界を置かせない
        if (/^avoid(-page)?$/.test(ba)) {
          const next = nextBoxAfter(el);
          if (next) joins.push({ start: Math.min(bottom, next.top), end: Math.max(bottom, next.top), pullTo: top });
        }
        if (/^avoid(-page)?$/.test(bb)) {
          const prev = prevBoxBefore(el);
          if (prev) joins.push({ start: Math.min(prev.bottom, top), end: Math.max(prev.bottom, top), pullTo: prev.top });
        }
      }
    }
    collectLinkAndOutline(el, style);

    /** @type {TableInfo|null} */
    let openedTable = null;
    if (style.display === 'table' || style.display === 'inline-table') {
      const r = el.getBoundingClientRect();
      openedTable = { top: r.top + sy, bottom: r.bottom + sy, headTop: 0, headBottom: 0, headItems: [], footTop: 0, footBottom: 0, footItems: [] };
      tables.push(openedTable);
    }
    const savedTable = currentTable;
    if (openedTable) currentTable = openedTable;
    const isHead = style.display === 'table-header-group' && currentTable && !currentTable.headItems.length;
    const isFoot = style.display === 'table-footer-group' && currentTable && !currentTable.footItems.length;
    const groupStart = isHead || isFoot ? out.length : -1;

    // overflow: hidden / clip / auto / scroll → 子孫を padding-box でクリップする
    const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
    /** @type {DisplayItem[]|null} */
    let clipSaved = null;
    /** @type {Box|null} */
    let clipBox = null;
    if (clips && style.display !== 'inline' && style.display !== 'contents' && el !== root) {
      const r = el.getBoundingClientRect();
      clipBox = boxFor(r, style, 'padding-box', parseRadius(style, r));
    }

    if (visible && style.display !== 'contents') {
      warnUnsupported(el, style);
      const rects = style.display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()];
      const collapse = style.borderCollapse === 'collapse' && /^table/.test(style.display) && style.display !== 'table-caption';
      const radius = rects.length === 1 ? parseRadius(style, /** @type {DOMRect} */ (rects[0])) : null;
      for (const r of rects) {
        if (r.width <= 0 && r.height <= 0) continue;
        paintBackground(r, style, alpha, z, radius);
        await paintBackgroundImage(el, r, style, alpha, z, radius);
        paintBorders(r, style, alpha, z, collapse, radius);
      }
      if (el.tagName === 'IMG' && rects[0]) {
        await paintImg(/** @type {HTMLImageElement} */ (el), /** @type {DOMRect} */ (rects[0]), style, alpha, z, radius);
      }
    }

    // text-decoration は子孫テキストへ伝播する
    let decorations = inherited.decorations;
    const decoLine = style.textDecorationLine;
    if (decoLine && decoLine !== 'none') {
      const color = parseColor(style.textDecorationColor) ?? parseColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
      decorations = [...decorations, { line: decoLine, color }];
    }

    if (clipBox) {
      clipSaved = out;
      out = [];
    }
    const next = { z, alpha, decorations };
    // インライン SVG: 子は SVG の規則で走査してパスに変換する
    if (el.tagName === 'svg' && el.namespaceURI === SVG_NS) {
      paintSvgChildren(el, alpha, z);
      if (clipBox && clipSaved) finishClip(clipBox, clipSaved, z);
      return;
    }
    for (const node of flatChildNodes(el)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (visible) paintText(/** @type {Text} */ (node), el, style, next);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        await visit(/** @type {Element} */ (node), next);
      }
    }
    if (clipBox && clipSaved) finishClip(clipBox, clipSaved, z);

    if ((isHead || isFoot) && currentTable && groupStart >= 0) {
      const r = el.getBoundingClientRect();
      const items = out.slice(groupStart);
      if (isHead) {
        currentTable.headTop = r.top + sy;
        currentTable.headBottom = r.bottom + sy;
        currentTable.headItems = items;
      } else {
        currentTable.footTop = r.top + sy;
        currentTable.footBottom = r.bottom + sy;
        currentTable.footItems = items;
      }
    }
    currentTable = savedTable;
  }

  /** @param {Element} el @param {CSSStyleDeclaration} style */
  function warnUnsupported(el, style) {
    for (const [prop, isSet] of UNSUPPORTED) {
      const v = String(style[prop] ?? '');
      if (isSet(v)) {
        warnOnce(`css:${prop}`, {
          code: 'unsupported-css',
          message: `CSS property "${camelToKebab(prop)}" is not supported in this version and will be ignored (first seen on <${el.tagName.toLowerCase()}>: ${v})`,
          element: el,
          property: camelToKebab(prop),
        });
      }
    }
    if (/^matrix3d/.test(style.transform)) {
      warnOnce('css:transform3d', { code: 'unsupported-css', message: '3D transforms are not supported; the element is drawn untransformed', element: el, property: 'transform' });
    }
  }

  /**
   * @param {DOMRect} r
   * @param {CSSStyleDeclaration} style
   * @param {number} alpha
   * @param {number} z
   * @param {Radius|null} radius
   */
  function paintBackground(r, style, alpha, z, radius) {
    const bg = parseColor(style.backgroundColor);
    if (!bg || bg.a <= 0) return;
    /** @type {RectItem} */
    const item = { type: 'rect', x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, color: withAlpha(bg, alpha), z, seq: seq++ };
    if (radius) item.radius = radius;
    out.push(item);
  }

  /**
   * @param {Element} el
   * @param {DOMRect} r
   * @param {CSSStyleDeclaration} style
   * @param {number} alpha
   * @param {number} z
   * @param {Radius|null} radius
   */
  async function paintBackgroundImage(el, r, style, alpha, z, radius) {
    if (style.backgroundImage === 'none') return;

    // background-origin / clip（既定: padding-box / border-box）
    const bgClip = boxFor(r, style, style.backgroundClip || 'border-box', radius);
    const bgOrigin = boxFor(r, style, style.backgroundOrigin || 'padding-box', null);

    // linear-gradient は PDF の軸シェーディングで描く
    const gradient = parseLinearGradient(style.backgroundImage, bgOrigin.w, bgOrigin.h);
    if (gradient) {
      out.push({ type: 'gradient', box: bgOrigin, clip: bgClip, gradient, alpha, z, seq: seq++ });
      return;
    }

    const url = parseBackgroundUrl(style.backgroundImage);
    if (!url) {
      warnOnce('css:backgroundImage', {
        code: 'unsupported-css',
        message: `background-image "${style.backgroundImage}" is not supported (a single url() or linear-gradient() is); ignored`,
        element: el,
        property: 'background-image',
      });
      return;
    }
    const img = await loadImage(new URL(url, el.ownerDocument.baseURI).href, ctx.warn, el);
    if (!img) return;
    const fit = fitImage(bgOrigin, img.width, img.height, style.backgroundSize, style.backgroundPosition);

    // background-repeat: 軸ごとにタイル位置を求め、描画領域（bgClip）を覆うまで並べる
    const [rx, ry] = splitRepeat(style.backgroundRepeat);
    const ax = tileAxis(rx, fit.x, fit.w, bgClip.x, bgClip.x + bgClip.w);
    const ay = tileAxis(ry, fit.y, fit.h, bgClip.y, bgClip.y + bgClip.h);
    const count = ax.positions.length * ay.positions.length;
    if (count > MAX_BG_TILES) {
      warnOnce('css:backgroundRepeat', {
        code: 'unsupported-css',
        message: `background-repeat would need ${count} tiles (limit ${MAX_BG_TILES}); drawn once instead. Use a larger background-size or a pre-tiled image.`,
        element: el,
        property: 'background-repeat',
      });
      out.push({ type: 'image', ...fit, image: img, clip: bgClip, alpha, z, seq: seq++ });
      return;
    }
    for (const y of ay.positions) {
      for (const x of ax.positions) {
        out.push({ type: 'image', x, y, w: ax.size, h: ay.size, image: img, clip: bgClip, alpha, z, seq: seq++ });
      }
    }
  }

  /**
   * @param {HTMLImageElement} el
   * @param {DOMRect} r
   * @param {CSSStyleDeclaration} style
   * @param {number} alpha
   * @param {number} z
   * @param {Radius|null} radius
   */
  async function paintImg(el, r, style, alpha, z, radius) {
    const src = el.currentSrc || el.src;
    if (!src) return;
    const img = await loadImage(src, ctx.warn, el);
    if (!img) return;
    const content = boxFor(r, style, 'content-box', radius);
    const fit = fitImage(content, img.width, img.height, objectFitToSize(style.objectFit), style.objectPosition);
    if (style.objectFit === 'scale-down' && (fit.w > img.width || fit.h > img.height)) {
      Object.assign(fit, fitImage(content, img.width, img.height, 'auto', style.objectPosition));
    }
    out.push({ type: 'image', ...fit, image: img, clip: content, alpha, z, seq: seq++ });
  }

  /**
   * border-box の矩形から指定ボックスを求める。
   * @param {DOMRect} r
   * @param {CSSStyleDeclaration} style
   * @param {string} box  'border-box' | 'padding-box' | 'content-box'
   * @param {Radius|null} radius
   * @returns {Box}
   */
  function boxFor(r, style, box, radius) {
    let x = r.left + sx;
    let y = r.top + sy;
    let w = r.width;
    let h = r.height;
    if (box === 'padding-box' || box === 'content-box') {
      const bt = cssPx(style.borderTopWidth);
      const br = cssPx(style.borderRightWidth);
      const bb = cssPx(style.borderBottomWidth);
      const bl = cssPx(style.borderLeftWidth);
      x += bl;
      y += bt;
      w -= bl + br;
      h -= bt + bb;
      if (radius) radius = /** @type {Radius} */ (radius.map((v) => Math.max(0, v - Math.max(bt, br, bb, bl))));
    }
    if (box === 'content-box') {
      const pt = cssPx(style.paddingTop);
      const pr = cssPx(style.paddingRight);
      const pb = cssPx(style.paddingBottom);
      const pl = cssPx(style.paddingLeft);
      x += pl;
      y += pt;
      w -= pl + pr;
      h -= pt + pb;
    }
    /** @type {Box} */
    const b = { x, y, w: Math.max(0, w), h: Math.max(0, h) };
    if (radius && radius.some((v) => v > 0)) b.radius = radius;
    return b;
  }

  /**
   * @param {DOMRect} r
   * @param {CSSStyleDeclaration} style
   * @param {number} alpha
   * @param {number} z
   * @param {boolean} collapse  border-collapse: collapse のテーブル要素か（境界線を辺の中心に描く）
   * @param {Radius|null} radius
   */
  function paintBorders(r, style, alpha, z, collapse, radius) {
    const x = r.left + sx;
    const y = r.top + sy;
    const w = r.width;
    const h = r.height;
    /** @type {('Top'|'Right'|'Bottom'|'Left')[]} */
    const names = ['Top', 'Right', 'Bottom', 'Left'];
    const sides = names.map((side) => ({
      side,
      width: cssPx(/** @type {string} */ (style[`border${side}Width`])),
      style: /** @type {string} */ (style[`border${side}Style`]),
      color: parseColor(/** @type {string} */ (style[`border${side}Color`])),
    }));
    const drawn = sides.filter((s) => s.width > 0 && s.style !== 'none' && s.style !== 'hidden' && s.color && s.color.a > 0);
    if (!drawn.length) return;

    // 角丸: 4 辺が同じ幅・色・スタイルなら角丸パスをストロークする
    if (radius && radius.some((v) => v > 0)) {
      const f = /** @type {typeof drawn[0]} */ (drawn[0]);
      const uniform =
        drawn.length === 4 &&
        drawn.every((s) => s.width === f.width && s.style === f.style && JSON.stringify(s.color) === JSON.stringify(f.color));
      if (uniform) {
        const bw = f.width;
        out.push({
          type: 'stroke-rrect',
          x: x + bw / 2,
          y: y + bw / 2,
          w: w - bw,
          h: h - bw,
          radius: /** @type {Radius} */ (radius.map((v) => Math.max(0, v - bw / 2))),
          width: bw,
          color: withAlpha(/** @type {Rgba} */ (f.color), alpha),
          dash: dashFor(f.style, bw),
          z,
          seq: seq++,
        });
        return;
      }
      warnOnce('css:borderRadiusNonUniform', {
        code: 'unsupported-css',
        message: 'border-radius with non-uniform borders is approximated with straight borders',
        property: 'border-radius',
      });
    }

    for (const s of drawn) {
      const bw = s.width;
      const c = withAlpha(/** @type {Rgba} */ (s.color), alpha);
      const horizontal = s.side === 'Top' || s.side === 'Bottom';
      const dir = s.side === 'Top' || s.side === 'Left' ? 1 : -1;
      const edge = s.side === 'Top' ? y : s.side === 'Bottom' ? y + h : s.side === 'Left' ? x : x + w;
      const dash = dashFor(s.style, bw);
      if (dash) {
        const center = collapse ? edge : edge + (bw / 2) * dir;
        out.push({
          type: 'line',
          x1: horizontal ? x : center,
          y1: horizontal ? center : y,
          x2: horizontal ? x + w : center,
          y2: horizontal ? center : y + h,
          width: bw,
          color: c,
          dash,
          z,
          seq: seq++,
        });
        continue;
      }
      // solid / double / groove / ridge / inset / outset は塗り矩形で近似
      const start = collapse ? edge - bw / 2 : dir > 0 ? edge : edge - bw;
      if (horizontal) out.push({ type: 'rect', x, y: start, w, h: bw, color: c, z, seq: seq++ });
      else out.push({ type: 'rect', x: start, y, w: bw, h, color: c, z, seq: seq++ });
    }
  }

  /**
   * @param {Text} node
   * @param {Element} parent
   * @param {CSSStyleDeclaration} style
   * @param {Inherited} inh
   */
  function paintText(node, parent, style, inh) {
    const raw = node.data;
    if (!raw) return;
    if (!/\S/.test(raw) && !raw.includes(' ')) {
      const range = node.ownerDocument.createRange();
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some((r) => r.width > 0)) return;
    }

    const color = withAlpha(parseColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 }, inh.alpha);
    const size = cssPx(style.fontSize);
    if (size <= 0) return;
    const families = splitFamilies(style.fontFamily);
    const weight = parseWeight(style.fontWeight);
    const fstyle = /** @type {'normal'|'italic'} */ (style.fontStyle === 'italic' || style.fontStyle === 'oblique' ? 'italic' : 'normal');

    const primary = ctx.registry.match(families, weight, fstyle) ?? ctx.registry.match(ctx.fontFallback, weight, fstyle);
    if (!primary) {
      const key = families.join(',');
      if (!missingFamilies.has(key)) {
        missingFamilies.add(key);
        ctx.warn({
          code: 'missing-font',
          message: `No registered font matches font-family "${style.fontFamily}" and no fallback is available; text will be skipped`,
          element: parent,
        });
      }
      return;
    }

    const lines = measureText(node, style, {
      registry: ctx.registry,
      families,
      fallback: ctx.fontFallback,
      primary,
      weight,
      fstyle,
      size,
      textMeasure: ctx.textMeasure,
      features: featureTagsOf(style),
      warn: ctx.warn,
      element: parent,
    });

    for (const line of lines) {
      if (!line.glyphs.length) continue;
      atoms.push({ top: line.top + sy, bottom: line.bottom + sy });
      out.push({
        type: 'text',
        x: line.glyphs[0]?.x ?? 0,
        y: line.baseline + sy,
        top: line.top + sy,
        bottom: line.bottom + sy,
        size,
        color,
        font: line.font,
        glyphs: line.glyphs.map((g) => ({ ...g, x: g.x + sx })),
        z: inh.z,
        seq: seq++,
      });
      for (const deco of inh.decorations) {
        const first = line.glyphs[0];
        const last = line.glyphs[line.glyphs.length - 1];
        if (!first || !last) continue;
        const x1 = first.x + sx;
        const x2 = last.x + last.advance + sx;
        const thickness = Math.max(1, size / 14);
        const c = withAlpha(deco.color, inh.alpha);
        if (deco.line.includes('underline')) {
          out.push({ type: 'rect', x: x1, y: line.baseline + sy + size * 0.08, w: x2 - x1, h: thickness, color: c, z: inh.z, seq: seq++ });
        }
        if (deco.line.includes('line-through')) {
          out.push({ type: 'rect', x: x1, y: line.baseline + sy - size * 0.3, w: x2 - x1, h: thickness, color: c, z: inh.z, seq: seq++ });
        }
      }
    }
  }

  await visit(root, { z: 0, alpha: 1, decorations: [] });
  sortItems(rootItems);
  // 文書の高さ: body の下端と、はみ出した命令（絶対配置など）の下端の大きい方。
  // body.scrollHeight はビューポート高さに膨らむことがあるので使わない。
  let height = root.getBoundingClientRect().bottom + sy;
  for (const it of rootItems) {
    if (it.type === 'rect' || it.type === 'stroke-rrect' || it.type === 'image') height = Math.max(height, it.y + it.h);
    else if (it.type === 'line') height = Math.max(height, it.y1, it.y2);
    else if (it.type === 'text' || it.type === 'group' || it.type === 'clip') height = Math.max(height, it.bottom);
  }
  /**
   * インライン SVG の子要素を走査し、図形をパス命令に変換する。
   * viewBox やプレゼンテーション属性の解決はブラウザに任せ、
   * 変換行列は getScreenCTM()、塗りと線は getComputedStyle() から取る。
   *
   * @param {Element} container
   * @param {number} alpha
   * @param {number} z
   */
  function paintSvgChildren(container, alpha, z) {
    for (const child of container.children) {
      if (child.namespaceURI !== SVG_NS) continue;
      const tag = child.tagName;
      if (SVG_NON_RENDERED.has(tag)) continue;
      const style = win.getComputedStyle(child);
      if (style.display === 'none') continue;
      const op = parseFloat(style.opacity);
      const a = alpha * (Number.isFinite(op) ? op : 1);
      if (a <= 0) continue;

      if (SVG_CONTAINERS.has(tag)) {
        paintSvgChildren(child, a, z);
        continue;
      }

      // 幾何プロパティは computed style を優先する（% 指定などをブラウザに解決させる）
      const attr = (/** @type {string} */ name) => {
        const v = style.getPropertyValue(name);
        if (v && /^-?[\d.]+px$/.test(v)) return String(parseFloat(v));
        return child.getAttribute(name) ?? '';
      };
      const segs = shapeToPath(child, attr);
      if (segs === null) {
        warnOnce(`svg:${tag}`, {
          code: 'unsupported-css',
          message: `<${tag}> inside an inline <svg> is not supported and was skipped (shapes are: path, rect, circle, ellipse, line, polyline, polygon)`,
          element: child,
        });
        continue;
      }
      if (!segs.length || style.visibility !== 'visible') continue;

      const ctm = /** @type {SVGGraphicsElement} */ (/** @type {unknown} */ (child)).getScreenCTM?.();
      if (!ctm) continue;
      const fill = svgPaint(child, style.fill, style.fillOpacity, a, 'fill');
      const stroke = svgStroke(child, style, a);
      if (!fill && !stroke) continue;

      const r = child.getBoundingClientRect();
      out.push({
        type: 'path',
        segs,
        matrix: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e + sx, ctm.f + sy],
        fill,
        evenOdd: style.fillRule === 'evenodd',
        stroke,
        top: r.top + sy,
        bottom: r.bottom + sy,
        z,
        seq: seq++,
      });
    }
  }

  /**
   * SVG の paint 値（`none` / `rgb(...)` / `url(#id)`）を色にする。塗らないなら null。
   * @param {Element} el
   * @param {string} value
   * @param {string} opacity
   * @param {number} alpha
   * @param {'fill'|'stroke'} kind
   * @returns {Rgba|null}
   */
  function svgPaint(el, value, opacity, alpha, kind) {
    if (!value || value === 'none') return null;
    if (value.startsWith('url(')) {
      warnOnce(`svg:${kind}:url`, {
        code: 'unsupported-css',
        message: `${kind} with a paint server (${value}) inside an inline <svg> is not supported; the shape is skipped`,
        element: el,
        property: kind,
      });
      return null;
    }
    const c = parseColor(value);
    if (!c) return null;
    const o = parseFloat(opacity);
    const f = alpha * (Number.isFinite(o) ? o : 1);
    return f === 1 ? c : { ...c, a: c.a * f };
  }

  /**
   * @param {Element} el
   * @param {CSSStyleDeclaration} style
   * @param {number} alpha
   * @returns {PathStroke|null}
   */
  function svgStroke(el, style, alpha) {
    const color = svgPaint(el, style.stroke, style.strokeOpacity, alpha, 'stroke');
    if (!color) return null;
    const width = cssPx(style.strokeWidth);
    if (!(width > 0)) return null;
    const dashes = (style.strokeDasharray || 'none')
      .split(/[\s,]+/)
      .map((v) => cssPx(v))
      .filter((v) => Number.isFinite(v) && v >= 0);
    const cap = style.strokeLinecap === 'round' ? 1 : style.strokeLinecap === 'square' ? 2 : 0;
    const join = style.strokeLinejoin === 'round' ? 1 : style.strokeLinejoin === 'bevel' ? 2 : 0;
    const miter = parseFloat(style.strokeMiterlimit);
    return {
      color,
      width,
      cap: /** @type {0|1|2} */ (cap),
      join: /** @type {0|1|2} */ (join),
      miter: Number.isFinite(miter) && miter >= 1 ? miter : 4,
      dash: dashes.length && dashes.some((v) => v > 0) ? dashes : null,
      dashOffset: cssPx(style.strokeDashoffset) || 0,
    };
  }

  /**
   * リンク注釈としおりの材料を集める。
   *
   * 描画命令ではないので DisplayList には入れず、WalkResult に別で持つ。
   * `getClientRects()` は transform 適用後の矩形を返すので、変形の中のリンクも
   * そのまま外接矩形として扱える（PDF の注釈は軸並行の矩形しか持てない）。
   *
   * @param {Element} el
   * @param {CSSStyleDeclaration} style
   */
  function collectLinkAndOutline(el, style) {
    // 飛び先になりうる id を記録する（<a name> も含む）
    const id = el.id || (el.tagName === 'A' ? el.getAttribute('name') : null);
    if (id && !anchors.has(id)) {
      const r = el.getBoundingClientRect();
      anchors.set(id, r.top + sy);
    }

    if (/^H[1-6]$/.test(el.tagName)) {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (text) headings.push({ level: Number(el.tagName[1]), text, y: el.getBoundingClientRect().top + sy });
    }

    if (el.tagName !== 'A') return;
    const href = el.getAttribute('href');
    if (!href) return;
    if (style.visibility !== 'visible') return;
    // 同じ文書内へのリンクは飛び先の id を覚えておき、ページが決まってから解決する
    const fragment = href.startsWith('#') ? decodeURIComponent(href.slice(1)) : null;
    /** @type {string} */
    let uri = href;
    if (!fragment) {
      try {
        uri = new URL(href, el.ownerDocument.baseURI).href;
      } catch {
        return; // 解決できない href は注釈にしない
      }
      // javascript: などは注釈にしない
      if (!/^(https?|mailto|tel|ftp|file):/i.test(uri)) return;
    }
    // インラインで折り返していると行ごとに矩形が返る
    for (const r of el.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      links.push({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, href: uri, fragment });
    }
  }

  /**
   * overflow クリップを閉じる。範囲外の命令は捨てる（クリップで消えた文字が抽出テキストに残らないように）。
   * @param {Box} clipBox
   * @param {DisplayItem[]} saved
   * @param {number} z
   */
  function finishClip(clipBox, saved, z) {
    const inside = out.filter((it) => intersects(it, clipBox));
    out = saved;
    if (inside.length) {
      out.push({ type: 'clip', box: clipBox, items: inside, top: clipBox.y, bottom: clipBox.y + clipBox.h, z, seq: seq++ });
    }
  }

  /**
   * el の子孫を飛ばして、文書順で次に現れる箱を返す。
   * 兄弟が無ければ親をさかのぼるので、`<section>` の最後の見出しに break-after: avoid を書いても
   * 次の `<section>` と結びつく。
   * @param {Element} el
   * @returns {{top: number, bottom: number}|null}
   */
  function nextBoxAfter(el) {
    /** @type {Element|null} */
    let node = el;
    while (node && node !== root) {
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        const box = edgeBoxIn(sib, 'first');
        if (box) return box;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * el の子孫と祖先を飛ばして、文書順で直前に現れる箱を返す。
   * @param {Element} el
   * @returns {{top: number, bottom: number}|null}
   */
  function prevBoxBefore(el) {
    /** @type {Element|null} */
    let node = el;
    while (node && node !== root) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const box = edgeBoxIn(sib, 'last');
        if (box) return box;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * el 自身が箱ならそれを、そうでなければ（display: contents / inline、高さ 0）
   * 子孫の最初／最後の箱を返す。
   * @param {Element} el
   * @param {'first'|'last'} side
   * @returns {{top: number, bottom: number}|null}
   */
  function edgeBoxIn(el, side) {
    if (SKIP_TAGS.has(el.tagName)) return null;
    const style = win.getComputedStyle(el);
    if (style.display === 'none') return null;
    if (style.display !== 'contents' && style.display !== 'inline') {
      const r = el.getBoundingClientRect();
      if (r.height > 0) return { top: r.top + sy, bottom: r.bottom + sy };
    }
    const children = [...el.children];
    if (side === 'last') children.reverse();
    for (const child of children) {
      const box = edgeBoxIn(child, side);
      if (box) return box;
    }
    return null;
  }

  return { items: rootItems, atoms, breaks, joins, tables, links, anchors, headings, height };
}

/** @param {DisplayItem[]} items */
function sortItems(items) {
  items.sort((a, b) => a.z - b.z || a.seq - b.seq);
  for (const it of items) if (it.type === 'group' || it.type === 'clip') sortItems(it.items);
}

/**
 * @param {string} style border-style
 * @param {number} bw
 * @returns {number[]|null}
 */
function dashFor(style, bw) {
  if (style === 'dashed') return [bw * 3, bw * 3];
  if (style === 'dotted') return [bw, bw];
  return null;
}

/**
 * computed border-*-radius（'4px' / '4px 6px' / '50%'）を px の Radius にする。
 * 楕円は水平方向の半径で近似する。
 * @param {CSSStyleDeclaration} style
 * @param {DOMRect} r
 * @returns {Radius|null}
 */
function parseRadius(style, r) {
  const one = (/** @type {string} */ v) => {
    const first = v.trim().split(/\s+/)[0] ?? '0px';
    return first.endsWith('%') ? (parseFloat(first) / 100) * r.width : cssPx(first);
  };
  const radius = /** @type {Radius} */ ([
    one(style.borderTopLeftRadius),
    one(style.borderTopRightRadius),
    one(style.borderBottomRightRadius),
    one(style.borderBottomLeftRadius),
  ]);
  return radius.some((v) => v > 0) ? radius : null;
}

/**
 * computed transform（'matrix(a, b, c, d, e, f)'）を解析する。none / 3D は null。
 * @param {string} value
 * @returns {[number, number, number, number, number, number]|null}
 */
export function parseTransform(value) {
  if (!value || value === 'none') return null;
  const m = /^matrix\(([^)]+)\)$/.exec(value.trim());
  if (!m) return null;
  const n = /** @type {string} */ (m[1]).split(',').map((s) => parseFloat(s));
  if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return null;
  const [a, b, c, d, e, f] = /** @type {[number, number, number, number, number, number]} */ (n);
  if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) return null;
  return [a, b, c, d, e, f];
}

/**
 * computed transform-origin（'40px 20px' または 3 値）→ [x, y] px
 * @param {string} value
 * @returns {[number, number]}
 */
function parseOrigin(value) {
  const parts = value.trim().split(/\s+/);
  return [cssPx(parts[0] ?? '0'), cssPx(parts[1] ?? '0')];
}

/**
 * 命令の外接矩形がボックスと重なるか（クリップで完全に消える命令の除去に使う）。
 * @param {DisplayItem} it
 * @param {Box} b
 */
function intersects(it, b) {
  let x1;
  let y1;
  let x2;
  let y2;
  if (it.type === 'rect' || it.type === 'stroke-rrect' || it.type === 'image') {
    x1 = it.x; y1 = it.y; x2 = it.x + it.w; y2 = it.y + it.h;
  } else if (it.type === 'line') {
    x1 = Math.min(it.x1, it.x2) - it.width; y1 = Math.min(it.y1, it.y2) - it.width;
    x2 = Math.max(it.x1, it.x2) + it.width; y2 = Math.max(it.y1, it.y2) + it.width;
  } else if (it.type === 'text') {
    const last = it.glyphs[it.glyphs.length - 1];
    x1 = it.x; y1 = it.top; x2 = last ? last.x + last.advance : it.x; y2 = it.bottom;
  } else if (it.type === 'path') {
    return true; // 変換行列で回転しうるので常に残す
  } else if (it.type === 'clip' || it.type === 'gradient') {
    const b2 = it.type === 'clip' ? it.box : it.clip;
    x1 = b2.x; y1 = b2.y; x2 = b2.x + b2.w; y2 = b2.y + b2.h;
  } else {
    return true; // group（transform）は境界が回転するので常に残す
  }
  return x2 > b.x && x1 < b.x + b.w && y2 > b.y && y1 < b.y + b.h;
}

/** @param {Rgba} c @param {number} alpha */
function withAlpha(c, alpha) {
  return alpha === 1 ? c : { ...c, a: c.a * alpha };
}

/** @param {string} s */
function camelToKebab(s) {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}
