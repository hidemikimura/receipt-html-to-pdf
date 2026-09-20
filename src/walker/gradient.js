// @ts-check
/**
 * CSS の linear-gradient を PDF の軸シェーディング（ShadingType 2）に落とすための解析。
 *
 * 入力は computed style の値なので、色は rgb()/rgba() に、角度は deg に正規化済み。
 * 出力は箱のローカル座標（左上原点・y 下向き・CSS px）でのグラデーション線と、
 * 0〜1 に正規化した色止め。
 */
import { parseColor } from '../units.js';

/**
 * @typedef {{t: number, color: import('../units.js').Rgba}} GradientStop
 * @typedef {{x0: number, y0: number, x1: number, y1: number, stops: GradientStop[]}} LinearGradient
 */

/**
 * computed の background-image が単一の linear-gradient ならそれを解析する。
 * 対応しない書式（repeating / radial / conic / 複数レイヤー）は null。
 *
 * @param {string} value  computed の background-image
 * @param {number} width  箱の幅（px）
 * @param {number} height 箱の高さ（px）
 * @returns {LinearGradient|null}
 */
export function parseLinearGradient(value, width, height) {
  const m = /^linear-gradient\((.*)\)$/s.exec(value.trim());
  if (!m) return null;
  const args = splitTopLevelCommas(/** @type {string} */ (m[1]));
  if (args.length < 2) return null;

  let i = 0;
  let angle = 180; // 既定は「to bottom」
  const first = /** @type {string} */ (args[0]).trim();
  // `in oklab` などの補間指定は無視して sRGB で近似する
  const head = first.replace(/^in\s+\S+(\s+\S+\s+hue)?\s*/i, '').trim();
  const dir = parseDirection(head);
  if (dir !== null) {
    angle = dir;
    i = 1;
  } else if (/^in\s/i.test(first) && head === '') {
    i = 1;
  }

  const rawStops = args.slice(i).map((s) => s.trim());
  if (rawStops.length < 2) return null;

  // グラデーション線の長さ（CSS 仕様: |W·sin θ| + |H·cos θ|）
  const rad = (angle * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const length = Math.abs(width * sin) + Math.abs(height * cos);
  if (!(length > 0)) return null;

  /** @type {GradientStop[]} */
  const stops = [];
  for (const raw of rawStops) {
    // "rgb(255, 0, 0) 30%" / "rgba(0, 0, 0, 0.5)" / "red 10px 20px"（二重指定）
    const sp = splitColorAndPositions(raw);
    if (!sp) return null;
    const color = parseColor(sp.color);
    if (!color) return null;
    if (!sp.positions.length) {
      stops.push({ t: NaN, color });
      continue;
    }
    for (const pos of sp.positions) {
      const t = resolvePosition(pos, length);
      if (t === null) return null;
      stops.push({ t, color });
    }
  }
  if (stops.length < 2) return null;

  fillMissingPositions(stops);

  // 中心を通る線分。CSS の角度は 0deg = 上向き、時計回り。y は下向きなので cos を反転する。
  const cx = width / 2;
  const cy = height / 2;
  const dx = sin;
  const dy = -cos;
  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
    stops,
  };
}

/**
 * `45deg` / `to right` / `to right bottom` を CSS 角度（0 = 上、時計回り）にする。
 * 方向指定でなければ null。
 * @param {string} s
 * @returns {number|null}
 */
function parseDirection(s) {
  const deg = /^(-?[\d.]+)deg$/.exec(s);
  if (deg) return ((parseFloat(/** @type {string} */ (deg[1])) % 360) + 360) % 360;
  const to = /^to\s+(.+)$/.exec(s);
  if (!to) return null;
  const words = /** @type {string} */ (to[1]).trim().split(/\s+/).sort().join(' ');
  /** @type {Record<string, number>} */
  const table = {
    top: 0,
    right: 90,
    bottom: 180,
    left: 270,
    'right top': 45,
    'bottom right': 135,
    'bottom left': 225,
    'left top': 315,
  };
  return table[words] ?? null;
}

/**
 * 色止めを「色」と「位置（0〜2 個）」に分ける。
 * @param {string} s
 * @returns {{color: string, positions: string[]}|null}
 */
function splitColorAndPositions(s) {
  // 関数記法（rgb(...)）を先に切り出す
  const fn = /^([a-z-]+\([^()]*\))\s*(.*)$/i.exec(s);
  if (fn) return { color: /** @type {string} */ (fn[1]), positions: splitWords(/** @type {string} */ (fn[2])) };
  const kw = /^(\S+)\s*(.*)$/.exec(s);
  if (!kw) return null;
  return { color: /** @type {string} */ (kw[1]), positions: splitWords(/** @type {string} */ (kw[2])) };
}

/** @param {string} s */
function splitWords(s) {
  const t = s.trim();
  return t ? t.split(/\s+/) : [];
}

/**
 * 位置指定（30% / 10px）をグラデーション線上の 0〜1 にする。
 * @param {string} pos
 * @param {number} length
 * @returns {number|null}
 */
function resolvePosition(pos, length) {
  const pct = /^(-?[\d.]+)%$/.exec(pos);
  if (pct) return parseFloat(/** @type {string} */ (pct[1])) / 100;
  const px = /^(-?[\d.]+)px$/.exec(pos);
  if (px) return parseFloat(/** @type {string} */ (px[1])) / length;
  return null;
}

/**
 * 位置の無い色止めを埋める。両端は 0 と 1、間は等間隔。
 * さらに前の位置を下回らないよう単調にする（CSS 仕様）。
 * @param {GradientStop[]} stops
 */
function fillMissingPositions(stops) {
  const last = stops.length - 1;
  if (Number.isNaN(/** @type {number} */ (stops[0]?.t))) /** @type {GradientStop} */ (stops[0]).t = 0;
  if (Number.isNaN(/** @type {number} */ (stops[last]?.t))) /** @type {GradientStop} */ (stops[last]).t = 1;
  for (let i = 1; i < last; i++) {
    if (!Number.isNaN(/** @type {number} */ (stops[i]?.t))) continue;
    // 次に位置が決まっている色止めまでを等分する
    let j = i + 1;
    while (j < last && Number.isNaN(/** @type {number} */ (stops[j]?.t))) j++;
    const from = /** @type {number} */ (stops[i - 1]?.t);
    const to = /** @type {number} */ (stops[j]?.t);
    for (let k = i; k < j; k++) {
      /** @type {GradientStop} */ (stops[k]).t = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
    i = j - 1;
  }
  for (let i = 1; i < stops.length; i++) {
    const prev = /** @type {number} */ (stops[i - 1]?.t);
    if (/** @type {number} */ (stops[i]?.t) < prev) /** @type {GradientStop} */ (stops[i]).t = prev;
  }
}

/** @param {string} s */
function splitTopLevelCommas(s) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
