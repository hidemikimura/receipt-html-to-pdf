// @ts-check
/**
 * DOM Walker — ブラウザがレイアウトした Document を走査し、DisplayList（描画命令の配列）を作る。
 * 座標はすべて CSS px、iframe ドキュメント座標（左上原点、y 下向き）。
 */
import { parseColor, cssPx } from '../units.js';
import { splitFamilies, parseWeight } from '../font/registry.js';
import { measureText } from './text.js';
import { loadImage, parseBackgroundUrl, fitImage, objectFitToSize } from './image.js';

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
 * @typedef {RectItem|LineItem|StrokeRRectItem|ImageItem|TextItem|GroupItem|ClipItem} DisplayItem
 *
 * @typedef {{top: number, bottom: number}} Atom  ページ境界を跨いではいけない縦範囲（行・表の行・画像・break-inside: avoid）
 * @typedef {{top: number, bottom: number, headTop: number, headBottom: number, headItems: DisplayItem[], footTop: number, footBottom: number, footItems: DisplayItem[]}} TableInfo
 * @typedef {{items: DisplayItem[], atoms: Atom[], breaks: number[], tables: TableInfo[], height: number}} WalkResult
 */

/**
 * @typedef {object} WalkContext
 * @property {import('../font/registry.js').FontRegistry} registry
 * @property {string[]} fontFallback
 * @property {(w: import('../index.js').ConversionWarning) => void} warn
 * @property {'font'|'measure'|'auto'} textMeasure
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'SVG', 'OBJECT', 'EMBED']);

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
        if (bi === 'avoid' || bi === 'avoid-page' || style.display === 'table-row' || style.display === 'table-header-group' || style.display === 'table-footer-group' || el.tagName === 'IMG') {
          atoms.push({ top, bottom });
        }
      }
    }
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
    for (const node of flatChildNodes(el)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (visible) paintText(/** @type {Text} */ (node), el, style, next);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        await visit(/** @type {Element} */ (node), next);
      }
    }
    if (clipBox && clipSaved) {
      // 完全に外にある命令は捨てる（クリップで消えた文字が抽出テキストに残らないように）
      const inside = out.filter((it) => intersects(it, /** @type {Box} */ (clipBox)));
      out = clipSaved;
      if (inside.length) {
        out.push({ type: 'clip', box: clipBox, items: inside, top: clipBox.y, bottom: clipBox.y + clipBox.h, z, seq: seq++ });
      }
    }

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
    const url = parseBackgroundUrl(style.backgroundImage);
    if (!url) {
      warnOnce('css:backgroundImage', {
        code: 'unsupported-css',
        message: `background-image "${style.backgroundImage}" is not supported (only a single url() is); ignored`,
        element: el,
        property: 'background-image',
      });
      return;
    }
    const img = await loadImage(new URL(url, el.ownerDocument.baseURI).href, ctx.warn, el);
    if (!img) return;
    if (style.backgroundRepeat !== 'no-repeat') {
      warnOnce('css:backgroundRepeat', {
        code: 'unsupported-css',
        message: `background-repeat "${style.backgroundRepeat}" is not supported; drawn once as no-repeat`,
        element: el,
        property: 'background-repeat',
      });
    }
    // background-origin / clip（既定: padding-box / border-box）
    const clipBox = boxFor(r, style, style.backgroundClip || 'border-box', radius);
    const originBox = boxFor(r, style, style.backgroundOrigin || 'padding-box', null);
    const fit = fitImage(originBox, img.width, img.height, style.backgroundSize, style.backgroundPosition);
    out.push({ type: 'image', ...fit, image: img, clip: clipBox, alpha, z, seq: seq++ });
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
  return { items: rootItems, atoms, breaks, tables, height };
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
  } else if (it.type === 'clip') {
    x1 = it.box.x; y1 = it.box.y; x2 = it.box.x + it.box.w; y2 = it.box.y + it.box.h;
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
