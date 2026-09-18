// @ts-check
/**
 * ページコンテンツストリームのビルダー。
 * 座標は PDF 座標系（左下原点、pt）で受け取る。CSS 座標からの変換は呼び出し側（page.js）が行う。
 */
import { num } from '../units.js';

export class ContentStream {
  constructor() {
    /** @type {string[]} */
    this.ops = [];
    this.depth = 0;
  }

  save() {
    this.ops.push('q');
    this.depth++;
    return this;
  }

  restore() {
    if (this.depth <= 0) throw new Error('ContentStream: unbalanced Q');
    this.ops.push('Q');
    this.depth--;
    return this;
  }

  /** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} e @param {number} f */
  transform(a, b, c, d, e, f) {
    this.ops.push(`${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} cm`);
    return this;
  }

  /** @param {string} gsName ExtGState リソース名 */
  setGState(gsName) {
    this.ops.push(`/${gsName} gs`);
    return this;
  }

  /** @param {number} r @param {number} g @param {number} b */
  fillColor(r, g, b) {
    this.ops.push(`${num(r)} ${num(g)} ${num(b)} rg`);
    return this;
  }

  /** @param {number} r @param {number} g @param {number} b */
  strokeColor(r, g, b) {
    this.ops.push(`${num(r)} ${num(g)} ${num(b)} RG`);
    return this;
  }

  /** @param {number} w */
  lineWidth(w) {
    this.ops.push(`${num(w)} w`);
    return this;
  }

  /** @param {number[]} pattern @param {number} [phase] */
  dash(pattern, phase = 0) {
    this.ops.push(`[${pattern.map(num).join(' ')}] ${num(phase)} d`);
    return this;
  }

  /** @param {0|1|2} cap */
  lineCap(cap) {
    this.ops.push(`${cap} J`);
    return this;
  }

  /** @param {number} x @param {number} y @param {number} w @param {number} h */
  rect(x, y, w, h) {
    this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`);
    return this;
  }

  /** @param {number} x @param {number} y */
  moveTo(x, y) {
    this.ops.push(`${num(x)} ${num(y)} m`);
    return this;
  }

  /** @param {number} x @param {number} y */
  lineTo(x, y) {
    this.ops.push(`${num(x)} ${num(y)} l`);
    return this;
  }

  /**
   * 3 次ベジェ曲線
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} x3 @param {number} y3
   */
  curveTo(x1, y1, x2, y2, x3, y3) {
    this.ops.push(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x3)} ${num(y3)} c`);
    return this;
  }

  closePath() {
    this.ops.push('h');
    return this;
  }

  /**
   * 角丸矩形のパスを追加する（PDF 座標: y 上向き、(x, y) は左下）。
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {[number, number, number, number]} r  [左上, 右上, 右下, 左下] の半径（pt）。CSS の順序
   */
  roundedRect(x, y, w, h, r) {
    const k = 0.5523; // 4/3·(√2−1)
    const max = Math.min(w, h) / 2;
    const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(v, max));
    const tl = clamp(r[0]);
    const tr = clamp(r[1]);
    const br = clamp(r[2]);
    const bl = clamp(r[3]);
    const top = y + h;
    const right = x + w;
    // 左上から時計回り（PDF 座標では上辺が y+h）
    this.moveTo(x + tl, top);
    this.lineTo(right - tr, top);
    if (tr) this.curveTo(right - tr + tr * k, top, right, top - tr + tr * k, right, top - tr);
    this.lineTo(right, y + br);
    if (br) this.curveTo(right, y + br - br * k, right - br + br * k, y, right - br, y);
    this.lineTo(x + bl, y);
    if (bl) this.curveTo(x + bl - bl * k, y, x, y + bl - bl * k, x, y + bl);
    this.lineTo(x, top - tl);
    if (tl) this.curveTo(x, top - tl + tl * k, x + tl - tl * k, top, x + tl, top);
    return this.closePath();
  }

  /**
   * 画像 XObject を (x, y) を左下として w×h で描く。
   * @param {string} name @param {number} x @param {number} y @param {number} w @param {number} h
   */
  image(name, x, y, w, h) {
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${name} Do Q`);
    return this;
  }

  fill() {
    this.ops.push('f');
    return this;
  }

  stroke() {
    this.ops.push('S');
    return this;
  }

  /** 現在のパスでクリップして新しいパスを開始する */
  clip() {
    this.ops.push('W n');
    return this;
  }

  /** @param {number} x @param {number} y @param {number} w @param {number} h */
  fillRect(x, y, w, h) {
    return this.rect(x, y, w, h).fill();
  }

  /**
   * テキストを描画する。
   * @param {string} fontName  リソース名（F1 など）
   * @param {number} size      フォントサイズ (pt)
   * @param {number} x         ベースライン始点 x (pt)
   * @param {number} y         ベースライン y (pt)
   * @param {Array<string|number>} tj  TJ 配列。文字列は 16 進 CID 列（<...> なし）、数値は 1/1000 単位の位置調整
   * @param {{charSpacing?: number, rise?: number}} [opts]
   */
  text(fontName, size, x, y, tj, opts = {}) {
    const parts = [];
    for (const t of tj) {
      if (typeof t === 'string') {
        if (t.length) parts.push(`<${t}>`);
      } else if (t !== 0) parts.push(num(t));
    }
    if (!parts.length) return this;
    this.ops.push('BT');
    this.ops.push(`/${fontName} ${num(size)} Tf`);
    if (opts.charSpacing) this.ops.push(`${num(opts.charSpacing)} Tc`);
    if (opts.rise) this.ops.push(`${num(opts.rise)} Ts`);
    this.ops.push(`1 0 0 1 ${num(x)} ${num(y)} Tm`);
    this.ops.push(`[${parts.join(' ')}] TJ`);
    this.ops.push('ET');
    return this;
  }

  /** @returns {Uint8Array} */
  toBytes() {
    if (this.depth !== 0) throw new Error(`ContentStream: ${this.depth} unclosed q`);
    return new TextEncoder().encode(this.ops.join('\n') + '\n');
  }
}
