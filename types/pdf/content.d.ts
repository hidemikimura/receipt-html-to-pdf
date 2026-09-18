export class ContentStream {
    /** @type {string[]} */
    ops: string[];
    depth: number;
    save(): this;
    restore(): this;
    /** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} e @param {number} f */
    transform(a: number, b: number, c: number, d: number, e: number, f: number): this;
    /** @param {string} gsName ExtGState リソース名 */
    setGState(gsName: string): this;
    /** @param {number} r @param {number} g @param {number} b */
    fillColor(r: number, g: number, b: number): this;
    /** @param {number} r @param {number} g @param {number} b */
    strokeColor(r: number, g: number, b: number): this;
    /** @param {number} w */
    lineWidth(w: number): this;
    /** @param {number[]} pattern @param {number} [phase] */
    dash(pattern: number[], phase?: number): this;
    /** @param {0|1|2} cap */
    lineCap(cap: 0 | 1 | 2): this;
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    rect(x: number, y: number, w: number, h: number): this;
    /** @param {number} x @param {number} y */
    moveTo(x: number, y: number): this;
    /** @param {number} x @param {number} y */
    lineTo(x: number, y: number): this;
    /**
     * 3 次ベジェ曲線
     * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} x3 @param {number} y3
     */
    curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this;
    closePath(): this;
    /**
     * 角丸矩形のパスを追加する（PDF 座標: y 上向き、(x, y) は左下）。
     * @param {number} x @param {number} y @param {number} w @param {number} h
     * @param {[number, number, number, number]} r  [左上, 右上, 右下, 左下] の半径（pt）。CSS の順序
     */
    roundedRect(x: number, y: number, w: number, h: number, r: [number, number, number, number]): this;
    /**
     * 画像 XObject を (x, y) を左下として w×h で描く。
     * @param {string} name @param {number} x @param {number} y @param {number} w @param {number} h
     */
    image(name: string, x: number, y: number, w: number, h: number): this;
    fill(): this;
    stroke(): this;
    /** 現在のパスでクリップして新しいパスを開始する */
    clip(): this;
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    fillRect(x: number, y: number, w: number, h: number): this;
    /**
     * テキストを描画する。
     * @param {string} fontName  リソース名（F1 など）
     * @param {number} size      フォントサイズ (pt)
     * @param {number} x         ベースライン始点 x (pt)
     * @param {number} y         ベースライン y (pt)
     * @param {Array<string|number>} tj  TJ 配列。文字列は 16 進 CID 列（<...> なし）、数値は 1/1000 単位の位置調整
     * @param {{charSpacing?: number, rise?: number}} [opts]
     */
    text(fontName: string, size: number, x: number, y: number, tj: Array<string | number>, opts?: {
        charSpacing?: number;
        rise?: number;
    }): this;
    /** @returns {Uint8Array} */
    toBytes(): Uint8Array;
}
