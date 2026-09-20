// @ts-check
/**
 * SVG のパスデータと基本図形を、PDF に出せる形（絶対座標の M / L / C / Z）へ正規化する。
 *
 * 円弧（A）は 3 次ベジェへ、二次ベジェ（Q / T）も 3 次へ変換する。
 * 座標は要素のユーザー単位のまま（変換行列は描画時に cm で適用する）。
 */

/**
 * @typedef {['M', number, number]|['L', number, number]|['C', number, number, number, number, number, number]|['Z']} PathSeg
 */

/**
 * `d` 属性を絶対座標の M / L / C / Z 列にする。
 * @param {string} d
 * @returns {PathSeg[]}
 */
export function parsePathData(d) {
  /** @type {PathSeg[]} */
  const out = [];
  const tokens = tokenize(d);
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // 直前の制御点（S / T の反射用）
  /** @type {[number, number]|null} */
  let lastC = null;
  /** @type {[number, number]|null} */
  let lastQ = null;
  let cmd = '';

  const num = () => {
    const t = tokens[i++];
    return typeof t === 'number' ? t : NaN;
  };
  const hasNum = () => typeof tokens[i] === 'number';

  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = /** @type {string} */ (tokens[i++]);
    else if (!cmd) break; // 数値から始まる不正なデータ
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;

    if (C === 'M') {
      x = num() + ox;
      y = num() + oy;
      out.push(['M', x, y]);
      startX = x;
      startY = y;
      lastC = lastQ = null;
      // 続く座標対は L / l 扱い
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (C === 'Z') {
      out.push(['Z']);
      x = startX;
      y = startY;
      lastC = lastQ = null;
      continue;
    }
    if (C === 'L') {
      x = num() + ox;
      y = num() + oy;
      out.push(['L', x, y]);
      lastC = lastQ = null;
    } else if (C === 'H') {
      x = num() + ox;
      out.push(['L', x, y]);
      lastC = lastQ = null;
    } else if (C === 'V') {
      y = num() + oy;
      out.push(['L', x, y]);
      lastC = lastQ = null;
    } else if (C === 'C') {
      const x1 = num() + ox;
      const y1 = num() + oy;
      const x2 = num() + ox;
      const y2 = num() + oy;
      x = num() + ox;
      y = num() + oy;
      out.push(['C', x1, y1, x2, y2, x, y]);
      lastC = [x2, y2];
      lastQ = null;
    } else if (C === 'S') {
      const rx = lastC ? 2 * x - lastC[0] : x;
      const ry = lastC ? 2 * y - lastC[1] : y;
      const x2 = num() + ox;
      const y2 = num() + oy;
      x = num() + ox;
      y = num() + oy;
      out.push(['C', rx, ry, x2, y2, x, y]);
      lastC = [x2, y2];
      lastQ = null;
    } else if (C === 'Q' || C === 'T') {
      let qx;
      let qy;
      if (C === 'Q') {
        qx = num() + ox;
        qy = num() + oy;
      } else {
        qx = lastQ ? 2 * x - lastQ[0] : x;
        qy = lastQ ? 2 * y - lastQ[1] : y;
      }
      const px = num() + ox;
      const py = num() + oy;
      // 二次 → 三次
      out.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py]);
      x = px;
      y = py;
      lastQ = [qx, qy];
      lastC = null;
    } else if (C === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num();
      const sweep = num();
      const px = num() + ox;
      const py = num() + oy;
      for (const seg of arcToCurves(x, y, px, py, rx, ry, rot, large !== 0, sweep !== 0)) out.push(seg);
      x = px;
      y = py;
      lastC = lastQ = null;
    } else {
      break; // 未知のコマンド
    }
    if (!hasNum() && typeof tokens[i] !== 'string') break;
  }
  return out;
}

/**
 * `d` を数値とコマンド文字に分解する。
 * @param {string} d
 * @returns {(string|number)[]}
 */
function tokenize(d) {
  /** @type {(string|number)[]} */
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) {
    if (m[1]) out.push(m[1]);
    else out.push(parseFloat(/** @type {string} */ (m[2])));
  }
  return out;
}

/**
 * 楕円円弧を 3 次ベジェ列にする（SVG 仕様 F.6 の実装）。
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} rx @param {number} ry @param {number} rotDeg
 * @param {boolean} large @param {boolean} sweep
 * @returns {PathSeg[]}
 */
export function arcToCurves(x1, y1, x2, y2, rx, ry, rotDeg, large, sweep) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [['L', x2, y2]];

  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;

  // 半径が小さすぎる場合は広げる（仕様 F.6.6）
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const angle = (/** @type {number} */ ux, /** @type {number} */ uy, /** @type {number} */ vx, /** @type {number} */ vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  // 1 区間あたり 90 度以下になるよう分割する
  const parts = Math.max(1, Math.ceil(Math.abs(dTheta / (Math.PI / 2))));
  const delta = dTheta / parts;
  const t = ((4 / 3) * Math.tan(delta / 4));
  /** @type {PathSeg[]} */
  const out = [];
  let th = theta1;
  for (let i = 0; i < parts; i++) {
    const th2 = th + delta;
    const cos1 = Math.cos(th);
    const sin1 = Math.sin(th);
    const cos2 = Math.cos(th2);
    const sin2 = Math.sin(th2);
    /** 楕円上の点とその接線から制御点を作る */
    const map = (/** @type {number} */ ex, /** @type {number} */ ey) => [cosP * rx * ex - sinP * ry * ey + cx, sinP * rx * ex + cosP * ry * ey + cy];
    const [px1, py1] = map(cos1, sin1);
    const [px2, py2] = map(cos2, sin2);
    const [c1x, c1y] = map(cos1 - t * sin1, sin1 + t * cos1);
    const [c2x, c2y] = map(cos2 + t * sin2, sin2 - t * cos2);
    void px1;
    void py1;
    out.push(['C', /** @type {number} */ (c1x), /** @type {number} */ (c1y), /** @type {number} */ (c2x), /** @type {number} */ (c2y), /** @type {number} */ (px2), /** @type {number} */ (py2)]);
    th = th2;
  }
  return out;
}

/**
 * 基本図形をパスにする。対応しない要素は null。
 * @param {Element} el
 * @param {(name: string) => string} attr  属性値（プレゼンテーション属性は computed style を優先しない純粋な幾何属性）
 * @returns {PathSeg[]|null}
 */
export function shapeToPath(el, attr) {
  const n = (/** @type {string} */ name, /** @type {number} */ dflt = 0) => {
    const v = parseFloat(attr(name));
    return Number.isFinite(v) ? v : dflt;
  };
  switch (el.tagName) {
    case 'path': {
      const d = attr('d');
      return d ? parsePathData(d) : [];
    }
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      if (w <= 0 || h <= 0) return [];
      let rx = attr('rx') === '' || attr('rx') === 'auto' ? NaN : n('rx');
      let ry = attr('ry') === '' || attr('ry') === 'auto' ? NaN : n('ry');
      if (Number.isNaN(rx) && Number.isNaN(ry)) return rectPath(x, y, w, h);
      if (Number.isNaN(rx)) rx = /** @type {number} */ (ry);
      if (Number.isNaN(ry)) ry = /** @type {number} */ (rx);
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return rectPath(x, y, w, h);
      return roundRectPath(x, y, w, h, rx, ry);
    }
    case 'circle': {
      const r = n('r');
      if (r <= 0) return [];
      return ellipsePath(n('cx'), n('cy'), r, r);
    }
    case 'ellipse': {
      const rx = n('rx');
      const ry = n('ry');
      if (rx <= 0 || ry <= 0) return [];
      return ellipsePath(n('cx'), n('cy'), rx, ry);
    }
    case 'line':
      return [
        ['M', n('x1'), n('y1')],
        ['L', n('x2'), n('y2')],
      ];
    case 'polyline':
    case 'polygon': {
      const pts = attr('points')
        .split(/[\s,]+/)
        .map(parseFloat)
        .filter((v) => Number.isFinite(v));
      if (pts.length < 4) return [];
      /** @type {PathSeg[]} */
      const out = [['M', /** @type {number} */ (pts[0]), /** @type {number} */ (pts[1])]];
      for (let i = 2; i + 1 < pts.length; i += 2) out.push(['L', /** @type {number} */ (pts[i]), /** @type {number} */ (pts[i + 1])]);
      if (el.tagName === 'polygon') out.push(['Z']);
      return out;
    }
    default:
      return null;
  }
}

/** @returns {PathSeg[]} */
function rectPath(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) {
  return [
    ['M', x, y],
    ['L', x + w, y],
    ['L', x + w, y + h],
    ['L', x, y + h],
    ['Z'],
  ];
}

const K = 0.5522847498307936; // 4/3·(√2−1)

/** @returns {PathSeg[]} */
function roundRectPath(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ rx, /** @type {number} */ ry) {
  const cx = rx * K;
  const cy = ry * K;
  const r = x + w;
  const b = y + h;
  return [
    ['M', x + rx, y],
    ['L', r - rx, y],
    ['C', r - rx + cx, y, r, y + ry - cy, r, y + ry],
    ['L', r, b - ry],
    ['C', r, b - ry + cy, r - rx + cx, b, r - rx, b],
    ['L', x + rx, b],
    ['C', x + rx - cx, b, x, b - ry + cy, x, b - ry],
    ['L', x, y + ry],
    ['C', x, y + ry - cy, x + rx - cx, y, x + rx, y],
    ['Z'],
  ];
}

/** @returns {PathSeg[]} */
function ellipsePath(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ rx, /** @type {number} */ ry) {
  const ox = rx * K;
  const oy = ry * K;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
    ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
    ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
    ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
    ['Z'],
  ];
}
