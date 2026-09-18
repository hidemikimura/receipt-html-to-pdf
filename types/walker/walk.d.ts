/**
 * @param {HTMLElement} root
 * @param {WalkContext} ctx
 * @returns {Promise<WalkResult>}
 */
export function walk(root: HTMLElement, ctx: WalkContext): Promise<WalkResult>;
/**
 * computed transform（'matrix(a, b, c, d, e, f)'）を解析する。none / 3D は null。
 * @param {string} value
 * @returns {[number, number, number, number, number, number]|null}
 */
export function parseTransform(value: string): [number, number, number, number, number, number] | null;
export type Rgba = import("../units.js").Rgba;
/**
 * [左上, 右上, 右下, 左下] px
 */
export type Radius = [number, number, number, number];
export type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
    radius?: Radius;
};
export type RectItem = {
    type: "rect";
    x: number;
    y: number;
    w: number;
    h: number;
    color: Rgba;
    radius?: Radius;
    z: number;
    seq: number;
};
export type LineItem = {
    type: "line";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    color: Rgba;
    dash: number[] | null;
    z: number;
    seq: number;
};
export type StrokeRRectItem = {
    type: "stroke-rrect";
    x: number;
    y: number;
    w: number;
    h: number;
    radius: Radius;
    width: number;
    color: Rgba;
    dash: number[] | null;
    z: number;
    seq: number;
};
export type ImageItem = {
    type: "image";
    x: number;
    y: number;
    w: number;
    h: number;
    image: import("./image.js").DecodedImage;
    clip: Box | null;
    alpha: number;
    z: number;
    seq: number;
};
/**
 * advance は px
 */
export type Glyph = {
    gid: number;
    cp: number;
    x: number;
    advance: number;
};
export type TextItem = {
    type: "text";
    x: number;
    y: number;
    top: number;
    bottom: number;
    size: number;
    color: Rgba;
    font: import("../font/registry.js").RegisteredFont;
    glyphs: Glyph[];
    z: number;
    seq: number;
};
export type GroupItem = {
    type: "group";
    matrix: [number, number, number, number, number, number];
    origin: {
        x: number;
        y: number;
    };
    items: DisplayItem[];
    top: number;
    bottom: number;
    z: number;
    seq: number;
};
/**
 * overflow: hidden
 */
export type ClipItem = {
    type: "clip";
    box: Box;
    items: DisplayItem[];
    top: number;
    bottom: number;
    z: number;
    seq: number;
};
export type DisplayItem = RectItem | LineItem | StrokeRRectItem | ImageItem | TextItem | GroupItem | ClipItem;
/**
 * ページ境界を跨いではいけない縦範囲（行・表の行・画像・break-inside: avoid）
 */
export type Atom = {
    top: number;
    bottom: number;
};
export type TableInfo = {
    top: number;
    bottom: number;
    headTop: number;
    headBottom: number;
    headItems: DisplayItem[];
    footTop: number;
    footBottom: number;
    footItems: DisplayItem[];
};
export type WalkResult = {
    items: DisplayItem[];
    atoms: Atom[];
    breaks: number[];
    tables: TableInfo[];
    height: number;
};
export type WalkContext = {
    registry: import("../font/registry.js").FontRegistry;
    fontFallback: string[];
    warn: (w: import("../index.js").ConversionWarning) => void;
    textMeasure: "font" | "measure" | "auto";
};
