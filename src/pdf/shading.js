// @ts-check
/**
 * 軸シェーディング（ShadingType 2）の生成。
 *
 * 色は Type 2（指数補間）関数を色止めの数だけ作り、Type 3（継ぎ合わせ）でつなぐ。
 * 色止めごとにアルファが変わる場合は、同じ形のグレースケールシェーディングを
 * 輝度ソフトマスクにして再現する（PDF には色とアルファを同時に持つシェーディングが無いため）。
 */
import { Name } from './writer.js';

/**
 * @typedef {import('../walker/gradient.js').GradientStop} GradientStop
 */

/**
 * 色止めから Type 2/3 関数を作る。
 * @param {import('./writer.js').PdfWriter} writer
 * @param {GradientStop[]} stops
 * @param {(c: import('../units.js').Rgba) => number[]} pick  色から成分配列を取り出す（RGB か グレー）
 * @returns {import('./writer.js').Ref}
 */
function buildFunction(writer, stops, pick) {
  const first = /** @type {GradientStop} */ (stops[0]);
  const last = /** @type {GradientStop} */ (stops[stops.length - 1]);
  const span = last.t - first.t;
  // 全区間が 1 点に潰れている場合は単色
  if (!(span > 0)) {
    return writer.add({ FunctionType: 2, Domain: [0, 1], C0: pick(first.color), C1: pick(last.color), N: 1 });
  }
  if (stops.length === 2) {
    return writer.add({ FunctionType: 2, Domain: [0, 1], C0: pick(first.color), C1: pick(last.color), N: 1 });
  }
  /** @type {import('./writer.js').PdfValue[]} */
  const functions = [];
  /** @type {number[]} */
  const bounds = [];
  /** @type {number[]} */
  const encode = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = /** @type {GradientStop} */ (stops[i]);
    const b = /** @type {GradientStop} */ (stops[i + 1]);
    functions.push(writer.add({ FunctionType: 2, Domain: [0, 1], C0: pick(a.color), C1: pick(b.color), N: 1 }));
    encode.push(0, 1);
    if (i > 0) bounds.push((a.t - first.t) / span);
  }
  return writer.add({ FunctionType: 3, Domain: [0, 1], Functions: functions, Bounds: bounds, Encode: encode });
}

/**
 * 軸シェーディングの辞書を作る。座標は PDF 座標（pt）。
 *
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{x0: number, y0: number, x1: number, y1: number}} coords
 * @param {GradientStop[]} stops
 * @param {'rgb'|'gray'} space
 * @returns {import('./writer.js').Ref}
 */
export function buildAxialShading(writer, coords, stops, space) {
  const pick =
    space === 'rgb'
      ? (/** @type {import('../units.js').Rgba} */ c) => [c.r, c.g, c.b]
      : (/** @type {import('../units.js').Rgba} */ c) => [c.a];
  return writer.add({
    ShadingType: 2,
    ColorSpace: new Name(space === 'rgb' ? 'DeviceRGB' : 'DeviceGray'),
    Coords: [coords.x0, coords.y0, coords.x1, coords.y1],
    Function: buildFunction(writer, stops, pick),
    Extend: [true, true],
  });
}

/**
 * 色止めのアルファが一定ならその値、そうでなければ null。
 * @param {GradientStop[]} stops
 * @returns {number|null}
 */
export function uniformAlpha(stops) {
  const a = /** @type {GradientStop} */ (stops[0]).color.a;
  return stops.every((s) => Math.abs(s.color.a - a) < 0.002) ? a : null;
}

/**
 * アルファが変化するグラデーション用の輝度ソフトマスクを作る。
 * グレースケールのシェーディングを描くフォーム XObject を /SMask に入れた ExtGState を返す。
 *
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{x0: number, y0: number, x1: number, y1: number}} coords  PDF 座標
 * @param {GradientStop[]} stops
 * @param {{x: number, y: number, w: number, h: number}} bbox  マスクを塗る範囲（PDF 座標）
 * @param {number} groupAlpha  要素から継承した不透明度（グラデーション全体に掛かる）
 * @returns {Promise<import('./writer.js').Ref>} ExtGState の参照
 */
export async function buildAlphaMaskGState(writer, coords, stops, bbox, groupAlpha) {
  const scaled = groupAlpha === 1 ? stops : stops.map((s) => ({ t: s.t, color: { ...s.color, a: s.color.a * groupAlpha } }));
  const shading = buildAxialShading(writer, coords, scaled, 'gray');
  const content = new TextEncoder().encode(`q ${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h} re W n /Sh0 sh Q\n`);
  const form = await writer.addStream(
    {
      Type: new Name('XObject'),
      Subtype: new Name('Form'),
      BBox: [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h],
      Group: { Type: new Name('Group'), S: new Name('Transparency'), CS: new Name('DeviceGray') },
      Resources: { Shading: { Sh0: shading } },
    },
    content,
  );
  return writer.add({
    Type: new Name('ExtGState'),
    SMask: { Type: new Name('Mask'), S: new Name('Luminosity'), G: form, BC: [0] },
    ca: 1,
    CA: 1,
  });
}
