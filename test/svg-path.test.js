// @ts-check
import { describe, it, expect } from 'vitest';
import { parsePathData, shapeToPath, arcToCurves } from '../src/walker/svg-path.js';

const r = (n) => Math.round(n * 1000) / 1000 + 0;
const rp = (segs) => segs.map((s) => [s[0], ...s.slice(1).map((v) => r(/** @type {number} */ (v)))]);

/** 属性参照（テスト用の簡易 DOM モック） */
const el = (tagName, attrs) => ({ tagName, attrs });
const attrOf = (e) => (name) => e.attrs[name] ?? '';

describe('parsePathData', () => {
  it('絶対座標の M / L / Z', () => {
    expect(rp(parsePathData('M 10 20 L 30 40 Z'))).toEqual([
      ['M', 10, 20],
      ['L', 30, 40],
      ['Z'],
    ]);
  });

  it('相対座標は絶対に直す', () => {
    expect(rp(parsePathData('m 10 10 l 5 0 l 0 5 z'))).toEqual([
      ['M', 10, 10],
      ['L', 15, 10],
      ['L', 15, 15],
      ['Z'],
    ]);
  });

  it('M のあとに続く座標対は L として扱う', () => {
    expect(rp(parsePathData('M 0 0 10 0 10 10'))).toEqual([
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
    ]);
  });

  it('H / V を L に展開する', () => {
    expect(rp(parsePathData('M 0 0 H 10 V 20 h -5 v -5'))).toEqual([
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 20],
      ['L', 5, 20],
      ['L', 5, 15],
    ]);
  });

  it('Z のあとは始点に戻る', () => {
    expect(rp(parsePathData('M 10 10 L 20 10 Z l 5 5'))).toEqual([
      ['M', 10, 10],
      ['L', 20, 10],
      ['Z'],
      ['L', 15, 15],
    ]);
  });

  it('S は直前の制御点を反射する', () => {
    const segs = parsePathData('M 0 0 C 10 0 20 10 20 20 S 30 40 40 40');
    expect(rp(segs)[2]).toEqual(['C', 20, 30, 30, 40, 40, 40]);
  });

  it('Q を 3 次ベジェに変換する', () => {
    // 制御点 (30,0)、終点 (60,0) → 3 次の制御点は 2/3 の位置
    expect(rp(parsePathData('M 0 0 Q 30 0 60 0'))[1]).toEqual(['C', 20, 0, 40, 0, 60, 0]);
  });

  it('T は直前の二次制御点を反射する', () => {
    const segs = rp(parsePathData('M 0 0 Q 10 10 20 0 T 40 0'));
    expect(segs).toHaveLength(3);
    expect(segs[2]?.[0]).toBe('C');
  });

  it('指数表記とカンマ・符号区切りを読む', () => {
    expect(rp(parsePathData('M1e1,2E1L-5-5'))).toEqual([
      ['M', 10, 20],
      ['L', -5, -5],
    ]);
  });

  it('不正なデータでも例外にしない', () => {
    expect(() => parsePathData('')).not.toThrow();
    expect(parsePathData('')).toEqual([]);
    expect(() => parsePathData('X 1 2 3')).not.toThrow();
  });
});

describe('arcToCurves', () => {
  it('半径 0 は直線にする', () => {
    expect(arcToCurves(0, 0, 10, 0, 0, 0, 0, false, false)).toEqual([['L', 10, 0]]);
  });

  it('始点と終点が同じなら何も出さない', () => {
    expect(arcToCurves(5, 5, 5, 5, 10, 10, 0, false, true)).toEqual([]);
  });

  it('半円は 2 区間のベジェになり、終点に届く', () => {
    const segs = arcToCurves(0, 0, 20, 0, 10, 10, 0, false, true);
    expect(segs).toHaveLength(2);
    const last = segs[segs.length - 1];
    expect(r(/** @type {number} */ (last?.[5]))).toBe(20);
    expect(r(/** @type {number} */ (last?.[6]))).toBe(0);
  });

  it('sweep の向きで通る側が変わる', () => {
    const up = arcToCurves(0, 0, 20, 0, 10, 10, 0, false, false);
    const down = arcToCurves(0, 0, 20, 0, 10, 10, 0, false, true);
    // 制御点の y 符号が逆になる
    expect(Math.sign(/** @type {number} */ (up[0]?.[2]))).toBe(-Math.sign(/** @type {number} */ (down[0]?.[2])));
  });

  it('半径が足りない場合は広げて必ず終点へ届く', () => {
    const segs = arcToCurves(0, 0, 100, 0, 10, 10, 0, false, true);
    const last = segs[segs.length - 1];
    expect(r(/** @type {number} */ (last?.[5]))).toBe(100);
  });
});

describe('shapeToPath', () => {
  const path = (tag, attrs) => {
    const e = el(tag, attrs);
    return rp(/** @type {any} */ (shapeToPath(/** @type {any} */ (e), attrOf(e))) ?? []);
  };

  it('rect', () => {
    expect(path('rect', { x: '1', y: '2', width: '10', height: '20' })).toEqual([
      ['M', 1, 2],
      ['L', 11, 2],
      ['L', 11, 22],
      ['L', 1, 22],
      ['Z'],
    ]);
  });

  it('幅か高さが 0 の rect は空', () => {
    expect(path('rect', { width: '0', height: '10' })).toEqual([]);
  });

  it('角丸 rect は 4 隅がベジェになる', () => {
    const p = path('rect', { width: '100', height: '50', rx: '10' });
    expect(p.filter((s) => s[0] === 'C')).toHaveLength(4);
  });

  it('rx だけ指定すると ry も同じ値になる', () => {
    expect(path('rect', { width: '100', height: '50', rx: '10' })).toEqual(path('rect', { width: '100', height: '50', rx: '10', ry: '10' }));
  });

  it('circle は 4 区間のベジェ', () => {
    const p = path('circle', { cx: '50', cy: '50', r: '20' });
    expect(p[0]).toEqual(['M', 70, 50]);
    expect(p.filter((s) => s[0] === 'C')).toHaveLength(4);
  });

  it('ellipse', () => {
    const p = path('ellipse', { cx: '0', cy: '0', rx: '30', ry: '10' });
    expect(p[0]).toEqual(['M', 30, 0]);
  });

  it('line', () => {
    expect(path('line', { x1: '0', y1: '0', x2: '10', y2: '10' })).toEqual([
      ['M', 0, 0],
      ['L', 10, 10],
    ]);
  });

  it('polygon は閉じ、polyline は閉じない', () => {
    expect(path('polygon', { points: '0,0 10,0 10,10' }).at(-1)).toEqual(['Z']);
    expect(path('polyline', { points: '0,0 10,0 10,10' }).at(-1)).toEqual(['L', 10, 10]);
  });

  it('未対応の要素は null', () => {
    const e = el('text', {});
    expect(shapeToPath(/** @type {any} */ (e), attrOf(e))).toBeNull();
  });
});
