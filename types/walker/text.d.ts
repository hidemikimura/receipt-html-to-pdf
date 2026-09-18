/**
 * @param {Text} node
 * @param {CSSStyleDeclaration} style
 * @param {MeasureOptions} o
 * @returns {MeasuredLine[]}
 */
export function measureText(node: Text, style: CSSStyleDeclaration, o: MeasureOptions): MeasuredLine[];
export type MeasuredLine = {
    font: import("../font/registry.js").RegisteredFont;
    /**
     * ベースライン y（ビューポート座標 px）
     */
    baseline: number;
    /**
     * 行内グリフ矩形の上端
     */
    top: number;
    /**
     * 行内グリフ矩形の下端
     */
    bottom: number;
    glyphs: import("./walk.js").Glyph[];
};
export type MeasureOptions = {
    registry: import("../font/registry.js").FontRegistry;
    families: string[];
    fallback: string[];
    primary: import("../font/registry.js").RegisteredFont;
    weight: number;
    fstyle: "normal" | "italic";
    /**
     * px
     */
    size: number;
    textMeasure: "font" | "measure" | "auto";
    warn: (w: import("../index.js").ConversionWarning) => void;
    element: Element;
};
