// @ts-check
/**
 * DisplayList を用紙に割り付け、PDF ドキュメントを組み立てる。
 * ページ範囲の決定は paginate.js、ここでは各ページに「本文（範囲指定）・繰り返し thead・ヘッダー・フッター」を描く。
 */
import { PdfWriter, pdfString, pdfDate, Name } from './pdf/writer.js';
import { ContentStream } from './pdf/content.js';
import { EmbeddedFont, hex4 } from './font/cid.js';
import { embedImage } from './pdf/image.js';
import { PX_TO_PT, PAGE_SIZES, lengthToPt, num } from './units.js';
import { paginate } from './paginate.js';
import { releasePixels, loadImage } from './walker/image.js';
import { buildAxialShading, uniformAlpha, buildAlphaMaskGState } from './pdf/shading.js';
import { buildLinkAnnot, buildOutline } from './pdf/outline.js';

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
export function resolvePage(page = {}) {
  const sizeOpt = page.size ?? 'A4';
  let width;
  let height;
  if (typeof sizeOpt === 'string') {
    const s = PAGE_SIZES[sizeOpt];
    if (!s) throw new Error(`Unknown page size "${sizeOpt}". Use one of ${Object.keys(PAGE_SIZES).join(', ')} or {width, height}.`);
    width = s.width;
    height = s.height;
  } else {
    width = lengthToPt(sizeOpt.width);
    height = lengthToPt(sizeOpt.height);
  }
  if ((page.orientation ?? 'portrait') === 'landscape' && width < height) [width, height] = [height, width];

  const m = page.margin ?? '15mm';
  const margins =
    typeof m === 'string'
      ? { top: lengthToPt(m), right: lengthToPt(m), bottom: lengthToPt(m), left: lengthToPt(m) }
      : { top: lengthToPt(m.top), right: lengthToPt(m.right), bottom: lengthToPt(m.bottom), left: lengthToPt(m.left) };
  return { width, height, ...margins };
}

/**
 * @param {import('./walker/walk.js').WalkResult} body
 * @param {PageGeometry} geo
 * @param {{compress: boolean, metadata?: import('./index.js').PdfMetadata, header?: PageDecoration|null, footer?: PageDecoration|null, pacer?: import('./pacer.js').Pacer, progress?: (p: import('./index.js').ConversionProgress) => void, warn?: (w: import('./index.js').ConversionWarning) => void, links?: boolean, outline?: boolean}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function buildPdf(body, geo, opts) {
  const writer = new PdfWriter({ compress: opts.compress });
  const headerPt = (opts.header?.heightPx ?? 0) * PX_TO_PT;
  const footerPt = (opts.footer?.heightPx ?? 0) * PX_TO_PT;
  const contentW = geo.width - geo.left - geo.right;
  const contentTop = geo.height - geo.top - headerPt; // 本文領域の上端（PDF 座標）
  const contentH = geo.height - geo.top - geo.bottom - headerPt - footerPt;
  if (contentH <= 0) throw new Error('Page content area is empty: margins + header + footer exceed the page height');
  const contentHpx = contentH / PX_TO_PT;

  // 1. ページ範囲を決める
  const ranges = paginate(body, contentHpx);
  const totalPages = ranges.length;

  // 2. ヘッダー／フッターをページごとに描画して走査結果を得る
  /** @type {(import('./walker/walk.js').WalkResult|null)[]} */
  const headers = [];
  /** @type {(import('./walker/walk.js').WalkResult|null)[]} */
  const footers = [];
  for (let p = 0; p < totalPages; p++) {
    headers.push(opts.header ? await opts.header.render(p + 1, totalPages) : null);
    footers.push(opts.footer ? await opts.footer.render(p + 1, totalPages) : null);
  }

  // 3. フォント・画像の使用を集める
  /** @type {Map<import('./font/registry.js').RegisteredFont, EmbeddedFont>} */
  const fonts = new Map();
  /** @type {Map<string, {name: string, image: import('./walker/image.js').DecodedImage}>} */
  const images = new Map();
  const collect = (/** @type {import('./walker/walk.js').DisplayItem[]} */ list) => {
    for (const it of list) {
      if (it.type === 'text') {
        let ef = fonts.get(it.font);
        if (!ef) {
          ef = new EmbeddedFont(it.font.parsed, `F${fonts.size + 1}`);
          fonts.set(it.font, ef);
        }
        for (const g of it.glyphs) ef.addGlyph(g.gid, g.cp);
      } else if (it.type === 'image') {
        if (!images.has(it.image.key)) images.set(it.image.key, { name: `Im${images.size + 1}`, image: it.image });
      } else if (it.type === 'group' || it.type === 'clip') {
        collect(it.items);
      }
    }
  };
  collect(body.items);
  for (const w of [...headers, ...footers]) if (w) collect(w.items);
  for (const ef of fonts.values()) ef.finalize();

  /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
  const fontDict = {};
  for (const ef of fonts.values()) fontDict[ef.resourceName] = await ef.embed(writer);
  /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
  const xobjDict = {};
  for (const im of images.values()) {
    let img = im.image;
    // 並行して走る別の変換が先に解放していた場合は読み直す
    if (!img.jpeg && !img.rgb) {
      const again = await loadImage(img.key, opts.warn ?? (() => {}));
      if (!again) continue;
      img = again;
    }
    xobjDict[im.name] = await embedImage(writer, img);
    // 埋め込みが済めばピクセルデータは不要。大きな文書のピーク使用量を抑える
    releasePixels(img);
    if (opts.pacer) await opts.pacer();
  }

  // ExtGState（透明度）
  /** @type {Map<string, string>} */
  const gstates = new Map();
  /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
  const gstateDict = {};
  const gsName = (/** @type {number} */ a, /** @type {number} */ strokeA = a) => {
    const key = `${num(a)}/${num(strokeA)}`;
    let name = gstates.get(key);
    if (!name) {
      name = `GS${gstates.size + 1}`;
      gstates.set(key, name);
      gstateDict[name] = writer.add({ Type: 'ExtGState', ca: a, CA: strokeA });
    }
    return name;
  };

  // Shading（linear-gradient）。座標は箱ローカルの CSS px で持ち、描画時に cm で用紙座標へ写す。
  // こうするとページごとに作り直さずに済む。
  /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
  const shadingDict = {};
  /** @type {Map<import('./walker/walk.js').DisplayItem, {sh: string, gs: string|null}>} */
  const gradients = new Map();
  /** @param {import('./walker/walk.js').DisplayItem[]} list */
  const prepareGradients = async (list) => {
    for (const it of list) {
      if (it.type === 'gradient') {
        const name = `Sh${Object.keys(shadingDict).length + 1}`;
        shadingDict[name] = buildAxialShading(writer, it.gradient, it.gradient.stops, 'rgb');
        const alpha = uniformAlpha(it.gradient.stops);
        let gs = null;
        if (alpha === null) {
          // 色止めごとにアルファが変わる → 輝度ソフトマスクで再現する
          const gsRef = await buildAlphaMaskGState(writer, it.gradient, it.gradient.stops, { x: 0, y: 0, w: it.box.w, h: it.box.h }, it.alpha);
          gs = `GM${gradients.size + 1}`;
          gstateDict[gs] = gsRef;
        }
        gradients.set(it, { sh: name, gs });
      } else if (it.type === 'group' || it.type === 'clip') {
        await prepareGradients(it.items);
      }
    }
  };
  await prepareGradients(body.items);
  for (const w of [...headers, ...footers]) if (w) await prepareGradients(w.items);

  const pagesRef = writer.reserve();
  /** @type {import('./pdf/writer.js').Ref[]} */
  const pageRefs = [];
  // リンクの飛び先は前後どちらのページにもなりうるので、ページ参照を先に確保しておく
  const pageSlots = Array.from({ length: totalPages }, () => writer.reserve());
  /** @param {number} i @returns {import('./pdf/writer.js').Ref} */
  const slotOf = (i) => /** @type {import('./pdf/writer.js').Ref} */ (pageSlots[i]);

  /**
   * ドキュメント y が載るページと、そのページでの PDF 座標を求める。
   * @param {number} docY
   * @returns {{page: number, x: number, y: number}|null}
   */
  const locate = (docY) => {
    for (let i = 0; i < totalPages; i++) {
      const r = /** @type {import('./paginate.js').PageRange} */ (ranges[i]);
      if (docY >= r.start - 0.01 && (docY < r.end - 0.01 || i === totalPages - 1)) {
        const top = contentTop - r.headShift * PX_TO_PT;
        return { page: i, x: geo.left, y: top - (docY - r.start) * PX_TO_PT };
      }
    }
    return null;
  };

  // 4. ページごとに描画
  opts.progress?.({ phase: 'layout', totalPages });
  for (let p = 0; p < totalPages; p++) {
    if (opts.pacer) await opts.pacer();
    opts.progress?.({ phase: 'page', page: p + 1, totalPages });
    const range = /** @type {import('./paginate.js').PageRange} */ (ranges[p]);
    const cs = new ContentStream();
    const painter = new Painter(cs, geo, fonts, images, gsName, gradients);

    // 本文: ドキュメント y = range.start が本文領域の上端 + 繰り返し thead の高さ に来る
    const bodyShiftPt = range.headShift * PX_TO_PT;
    const footShiftPt = range.footShift * PX_TO_PT;
    cs.save();
    cs.rect(geo.left, contentTop - contentH + footShiftPt, contentW, contentH - bodyShiftPt - footShiftPt).clip();
    painter.setOrigin(contentTop - bodyShiftPt, range.start);
    painter.render(body.items, range);
    cs.restore();

    // 繰り返し tfoot: ブラウザの印刷と同じく、このページに載った最後の行の直下に置く
    const bodyEndPt = contentTop - bodyShiftPt - (range.end - range.start) * PX_TO_PT;
    for (const f of range.feet) {
      const fPt = (f.table.footBottom - f.table.footTop) * PX_TO_PT;
      const bottomPt = bodyEndPt - f.shift * PX_TO_PT - fPt;
      cs.save();
      cs.rect(geo.left, bottomPt, contentW, fPt).clip();
      painter.setOrigin(bottomPt + fPt, f.table.footTop);
      painter.render(f.table.footItems);
      cs.restore();
    }

    // 繰り返し thead
    for (const h of range.heads) {
      cs.save();
      const hPt = (h.table.headBottom - h.table.headTop) * PX_TO_PT;
      cs.rect(geo.left, contentTop - h.shift * PX_TO_PT - hPt, contentW, hPt).clip();
      painter.setOrigin(contentTop - h.shift * PX_TO_PT, h.table.headTop);
      painter.render(h.table.headItems);
      cs.restore();
    }

    // ヘッダー／フッター
    const header = headers[p];
    if (header) {
      cs.save();
      cs.rect(geo.left, geo.height - geo.top - headerPt, contentW, headerPt).clip();
      painter.setOrigin(geo.height - geo.top, 0);
      painter.render(header.items);
      cs.restore();
    }
    const footer = footers[p];
    if (footer) {
      cs.save();
      cs.rect(geo.left, geo.bottom, contentW, footerPt).clip();
      painter.setOrigin(geo.bottom + footerPt, 0);
      painter.render(footer.items);
      cs.restore();
    }

    // リンク注釈。ページ範囲で切り取ってから用紙座標へ写す
    /** @type {import('./pdf/writer.js').PdfValue[]} */
    const annots = [];
    if (opts.links !== false) {
      /**
       * @param {import('./walker/walk.js').LinkRect[]} list
       * @param {number} pdfTop   この帯の上端（PDF 座標）
       * @param {number} docTop   その位置に対応するドキュメント y
       * @param {number} docEnd   この帯に出せるドキュメント y の終わり
       */
      const addLinks = (list, pdfTop, docTop, docEnd) => {
        for (const link of list) {
          const y0 = Math.max(link.y, docTop);
          const y1 = Math.min(link.y + link.h, docEnd);
          if (y1 - y0 <= 0.01) continue;
          const rect = {
            x: geo.left + link.x * PX_TO_PT,
            y: pdfTop - (y1 - docTop) * PX_TO_PT,
            w: link.w * PX_TO_PT,
            h: (y1 - y0) * PX_TO_PT,
          };
          if (link.fragment === null) {
            annots.push(buildLinkAnnot(writer, rect, { uri: link.href }));
            continue;
          }
          const targetY = body.anchors?.get(link.fragment);
          if (targetY === undefined) continue; // 飛び先が無いリンクは注釈にしない
          const at = locate(targetY);
          if (!at) continue;
          annots.push(buildLinkAnnot(writer, rect, { dest: [slotOf(at.page), new Name('XYZ'), at.x, at.y, null] }));
        }
      };
      addLinks(body.links ?? [], contentTop - bodyShiftPt, range.start, range.end);
      if (header) addLinks(header.links ?? [], geo.height - geo.top, 0, headerPt / PX_TO_PT);
      if (footer) addLinks(footer.links ?? [], geo.bottom + footerPt, 0, footerPt / PX_TO_PT);
    }

    const contentRef = await writer.addStream({}, cs.toBytes());
    /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
    const pageDict = {
      Type: 'Page',
      Parent: pagesRef,
      MediaBox: [0, 0, geo.width, geo.height],
      Resources: {
        Font: fontDict,
        XObject: xobjDict,
        ExtGState: gstateDict,
        Shading: shadingDict,
        ProcSet: [new Name('PDF'), new Name('Text'), new Name('ImageC')],
      },
      Contents: contentRef,
    };
    if (annots.length) pageDict.Annots = annots;
    const slot = slotOf(p);
    writer.set(slot, pageDict);
    pageRefs.push(slot);
  }

  writer.set(pagesRef, { Type: 'Pages', Kids: pageRefs, Count: pageRefs.length });

  // しおり: 見出しから木を作る
  let outlineRef = null;
  if (opts.outline) {
    outlineRef = buildOutline(
      writer,
      (body.headings ?? []).map((h) => {
        const at = locate(h.y);
        return { level: h.level, text: h.text, dest: at ? [slotOf(at.page), new Name('XYZ'), at.x, at.y, null] : null };
      }),
    );
  }

  /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
  const catalogDict = { Type: 'Catalog', Pages: pagesRef };
  if (outlineRef) {
    catalogDict.Outlines = outlineRef;
    catalogDict.PageMode = new Name('UseOutlines');
  }
  const catalog = writer.add(catalogDict);

  const md = opts.metadata ?? {};
  /** @type {{[key: string]: import('./pdf/writer.js').PdfValue}} */
  const info = {
    Producer: pdfString('receipt-html-to-pdf'),
    Creator: pdfString(md.creator ?? 'receipt-html-to-pdf'),
    CreationDate: pdfDate(md.creationDate ?? new Date()),
  };
  if (md.title) info.Title = pdfString(md.title);
  if (md.author) info.Author = pdfString(md.author);
  if (md.subject) info.Subject = pdfString(md.subject);
  if (md.keywords) info.Keywords = pdfString(md.keywords);
  const infoRef = writer.add(info);

  return writer.build(catalog, infoRef);
}

/**
 * 命令がページ範囲 [start, end) に属するか。
 * テキストは行が分割されない前提で行の中心位置で判定し（クリップで消えた文字が抽出テキストに残らないように）、
 * 矩形・線・画像・グループは範囲と重なれば含める（見えない部分はクリップされる）。
 * @param {import('./walker/walk.js').DisplayItem} it
 * @param {{start: number, end: number}} range
 */
function inRange(it, range) {
  const EPS = 0.01;
  if (it.type === 'text') {
    const mid = (it.top + it.bottom) / 2;
    return mid >= range.start - EPS && mid < range.end - EPS;
  }
  return itemBottom(it) > range.start + EPS && itemTop(it) < range.end - EPS;
}

/**
 * DisplayList を PDF コンテンツストリームへ描く。
 * setOrigin() で「ドキュメント y = docY を PDF の y = pdfY に置く」対応を切り替える。
 */
class Painter {
  /**
   * @param {ContentStream} cs
   * @param {PageGeometry} geo
   * @param {Map<import('./font/registry.js').RegisteredFont, EmbeddedFont>} fonts
   * @param {Map<string, {name: string, image: import('./walker/image.js').DecodedImage}>} images
   * @param {(alpha: number, strokeAlpha?: number) => string} gsName
   * @param {Map<import('./walker/walk.js').DisplayItem, {sh: string, gs: string|null}>} gradients
   */
  constructor(cs, geo, fonts, images, gsName, gradients) {
    this.cs = cs;
    this.geo = geo;
    this.fonts = fonts;
    this.images = images;
    this.gsName = gsName;
    this.gradients = gradients;
    this.pdfTop = geo.height - geo.top;
    this.docTop = 0;
    this.curAlpha = 1;
  }

  /**
   * @param {number} pdfY  PDF 座標（pt, 上向き）
   * @param {number} docY  ドキュメント座標（px, 下向き）
   */
  setOrigin(pdfY, docY) {
    this.pdfTop = pdfY;
    this.docTop = docY;
  }

  /** @param {number} x */
  X(x) {
    return this.geo.left + x * PX_TO_PT;
  }

  /** @param {number} y */
  Y(y) {
    return this.pdfTop - (y - this.docTop) * PX_TO_PT;
  }

  /** @param {number} a */
  setAlpha(a) {
    if (Math.abs(a - this.curAlpha) < 0.001) return;
    this.cs.setGState(this.gsName(a));
    this.curAlpha = a;
  }

  /** @param {import('./walker/walk.js').Radius|undefined} r */
  radiusPt(r) {
    return /** @type {[number, number, number, number]} */ ((r ?? [0, 0, 0, 0]).map((v) => v * PX_TO_PT));
  }

  /** @param {import('./walker/walk.js').Box} b */
  clipBox(b) {
    const cs = this.cs;
    if (b.radius) cs.roundedRect(this.X(b.x), this.Y(b.y + b.h), b.w * PX_TO_PT, b.h * PX_TO_PT, this.radiusPt(b.radius));
    else cs.rect(this.X(b.x), this.Y(b.y + b.h), b.w * PX_TO_PT, b.h * PX_TO_PT);
    cs.clip();
  }

  /**
   * @param {import('./walker/walk.js').DisplayItem[]} list
   * @param {{start: number, end: number}} [range]  指定するとこの範囲に属する命令だけを描く（子グループにも適用）
   */
  render(list, range) {
    const cs = this.cs;
    for (const it of list) {
      if (range && !inRange(it, range)) continue;
      if (it.type === 'rect') {
        if (it.w <= 0 || it.h <= 0) continue;
        cs.save();
        this.setAlpha(it.color.a);
        cs.fillColor(it.color.r, it.color.g, it.color.b);
        if (it.radius) cs.roundedRect(this.X(it.x), this.Y(it.y + it.h), it.w * PX_TO_PT, it.h * PX_TO_PT, this.radiusPt(it.radius)).fill();
        else cs.fillRect(this.X(it.x), this.Y(it.y + it.h), it.w * PX_TO_PT, it.h * PX_TO_PT);
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'line') {
        cs.save();
        this.setAlpha(it.color.a);
        cs.strokeColor(it.color.r, it.color.g, it.color.b);
        cs.lineWidth(it.width * PX_TO_PT);
        if (it.dash) cs.dash(it.dash.map((d) => d * PX_TO_PT));
        cs.moveTo(this.X(it.x1), this.Y(it.y1)).lineTo(this.X(it.x2), this.Y(it.y2)).stroke();
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'stroke-rrect') {
        cs.save();
        this.setAlpha(it.color.a);
        cs.strokeColor(it.color.r, it.color.g, it.color.b);
        cs.lineWidth(it.width * PX_TO_PT);
        if (it.dash) cs.dash(it.dash.map((d) => d * PX_TO_PT));
        cs.roundedRect(this.X(it.x), this.Y(it.y + it.h), it.w * PX_TO_PT, it.h * PX_TO_PT, this.radiusPt(it.radius)).stroke();
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'path') {
        if (!it.segs.length) continue;
        const [a, b2, c, d, e, f] = it.matrix;
        // ユーザー単位 → ドキュメント px → PDF pt（y 反転）を 1 つの行列にまとめる
        const S = PX_TO_PT;
        const tx = this.geo.left;
        const ty = this.pdfTop + this.docTop * S;
        cs.save();
        cs.transform(S * a, -S * b2, S * c, -S * d, S * e + tx, -S * f + ty);
        if (it.fill) cs.fillColor(it.fill.r, it.fill.g, it.fill.b);
        if (it.stroke) {
          cs.strokeColor(it.stroke.color.r, it.stroke.color.g, it.stroke.color.b);
          cs.lineWidth(it.stroke.width);
          cs.lineCap(it.stroke.cap);
          cs.lineJoin(it.stroke.join);
          if (it.stroke.join === 0) cs.miterLimit(it.stroke.miter);
          if (it.stroke.dash) cs.dash(it.stroke.dash, it.stroke.dashOffset);
        }
        // 塗りと線でアルファが違うことがあるので ExtGState には両方を渡す
        const fa = it.fill ? it.fill.a : 1;
        const sa = it.stroke ? it.stroke.color.a : 1;
        if (fa !== 1 || sa !== 1) cs.setGState(this.gsName(fa, sa));
        cs.path(it.segs);
        if (it.fill && it.stroke) cs.fillAndStroke(it.evenOdd);
        else if (it.fill) cs.fill(it.evenOdd);
        else cs.stroke();
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'gradient') {
        const g = this.gradients.get(it);
        if (!g || it.box.w <= 0 || it.box.h <= 0) continue;
        cs.save();
        this.clipBox(it.clip);
        // 箱ローカルの CSS px 空間（左上原点・y 下向き）へ写す。シェーディングの座標系もこれ。
        cs.transform(PX_TO_PT, 0, 0, -PX_TO_PT, this.X(it.box.x), this.Y(it.box.y));
        if (g.gs) cs.setGState(g.gs);
        else this.setAlpha(it.alpha);
        cs.shading(g.sh);
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'image') {
        const im = this.images.get(it.image.key);
        if (!im || it.w <= 0 || it.h <= 0) continue;
        cs.save();
        this.setAlpha(it.alpha);
        if (it.clip) this.clipBox(it.clip);
        cs.image(im.name, this.X(it.x), this.Y(it.y + it.h), it.w * PX_TO_PT, it.h * PX_TO_PT);
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'text') {
        const ef = /** @type {EmbeddedFont} */ (this.fonts.get(it.font));
        const tj = buildTJ(it, ef);
        cs.save();
        this.setAlpha(it.color.a);
        cs.fillColor(it.color.r, it.color.g, it.color.b);
        cs.text(ef.resourceName, it.size * PX_TO_PT, this.X(it.x), this.Y(it.y), tj);
        cs.restore();
        this.curAlpha = 1;
      } else if (it.type === 'group') {
        // CSS 行列 (a b c d e f) を、PDF 座標（y 反転・0.75 倍）で同じ変換になる行列に写す。
        // 線形部は y 反転により b, c の符号が反転し、変換の中心 origin は不動点として残す。
        const [a, b, c, d] = it.matrix;
        const ox = this.X(it.origin.x);
        const oy = this.Y(it.origin.y);
        const a2 = a;
        const b2 = -b;
        const c2 = -c;
        const d2 = d;
        const e2 = ox - (a2 * ox + c2 * oy) + it.matrix[4] * PX_TO_PT;
        const f2 = oy - (b2 * ox + d2 * oy) - it.matrix[5] * PX_TO_PT;
        cs.save();
        cs.transform(a2, b2, c2, d2, e2, f2);
        this.render(it.items, range);
        cs.restore();
      } else if (it.type === 'clip') {
        cs.save();
        this.clipBox(it.box);
        this.render(it.items, range);
        cs.restore();
      }
    }
  }
}

/**
 * グリフ列を TJ 配列にする。
 * 実測したペン位置と、フォントの advance から計算した位置との差を 1/1000 単位の調整値として挿入する。
 * これによりカーニング・letter-spacing・両端揃えがそのまま再現される。
 * @param {import('./walker/walk.js').TextItem} it
 * @param {EmbeddedFont} ef
 * @returns {Array<string|number>}
 */
function buildTJ(it, ef) {
  /** @type {Array<string|number>} */
  const out = [];
  let hex = '';
  for (let i = 0; i < it.glyphs.length; i++) {
    const g = /** @type {import('./walker/walk.js').Glyph} */ (it.glyphs[i]);
    hex += hex4(ef.cid(g.gid));
    const next = it.glyphs[i + 1];
    if (!next) break;
    const expected = g.x + g.advance;
    const gap = next.x - expected; // px
    const adj = (-gap / it.size) * 1000; // 正の値で左へ寄る
    if (Math.abs(adj) >= 0.5) {
      out.push(hex, Math.round(adj * 10) / 10);
      hex = '';
    }
  }
  if (hex) out.push(hex);
  return out;
}

/** @param {import('./walker/walk.js').DisplayItem} it */
function itemTop(it) {
  if (it.type === 'rect' || it.type === 'stroke-rrect' || it.type === 'image') return it.y;
  if (it.type === 'gradient') return it.clip.y;
  if (it.type === 'path') return it.top;
  if (it.type === 'line') return Math.min(it.y1, it.y2) - it.width / 2;
  if (it.type === 'group' || it.type === 'clip') return it.top;
  return it.top;
}

/** @param {import('./walker/walk.js').DisplayItem} it */
function itemBottom(it) {
  if (it.type === 'rect' || it.type === 'stroke-rrect' || it.type === 'image') return it.y + it.h;
  if (it.type === 'gradient') return it.clip.y + it.clip.h;
  if (it.type === 'path') return it.bottom;
  if (it.type === 'line') return Math.max(it.y1, it.y2) + it.width / 2;
  if (it.type === 'group' || it.type === 'clip') return it.bottom;
  return it.bottom;
}
