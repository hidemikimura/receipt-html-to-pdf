// @ts-check
import { describe, it, expect } from 'vitest';
import { parseLinearGradient } from '../src/walker/gradient.js';

const round = (n) => Math.round(n * 100) / 100 + 0;
/** @param {import('../src/walker/gradient.js').LinearGradient|null} g */
const line = (g) => (g ? [round(g.x0), round(g.y0), round(g.x1), round(g.y1)] : null);
const ts = (g) => (g ? g.stops.map((s) => round(s.t)) : null);

describe('parseLinearGradient', () => {
  it('既定は上から下（to bottom）', () => {
    const g = parseLinearGradient('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))', 200, 100);
    expect(line(g)).toEqual([100, 0, 100, 100]);
    expect(ts(g)).toEqual([0, 1]);
    expect(g?.stops[0]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it('to right は横方向で、線の長さは幅になる', () => {
    const g = parseLinearGradient('linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))', 200, 100);
    expect(line(g)).toEqual([0, 50, 200, 50]);
  });

  it('角度指定（0deg = 上向き）', () => {
    const g = parseLinearGradient('linear-gradient(0deg, rgb(0, 0, 0), rgb(255, 255, 255))', 100, 100);
    expect(line(g)).toEqual([50, 100, 50, 0]);
  });

  it('45deg は右上向き、線の長さは |W·sinθ| + |H·cosθ|', () => {
    const g = parseLinearGradient('linear-gradient(45deg, rgb(0, 0, 0), rgb(255, 255, 255))', 100, 100);
    // 長さ = 100·0.707 + 100·0.707 ≈ 141.42
    const len = Math.hypot((g?.x1 ?? 0) - (g?.x0 ?? 0), (g?.y1 ?? 0) - (g?.y0 ?? 0));
    expect(round(len)).toBe(141.42);
    expect((g?.y1 ?? 0) < (g?.y0 ?? 0)).toBe(true); // 上向き
  });

  it('to right bottom は 135deg', () => {
    const a = parseLinearGradient('linear-gradient(to right bottom, rgb(0,0,0), rgb(255,255,255))', 100, 100);
    const b = parseLinearGradient('linear-gradient(135deg, rgb(0,0,0), rgb(255,255,255))', 100, 100);
    expect(line(a)).toEqual(line(b));
  });

  it('% 指定の色止め', () => {
    const g = parseLinearGradient('linear-gradient(45deg, rgb(255,0,0) 0%, rgb(255,255,0) 30%, rgb(0,0,255) 100%)', 100, 100);
    expect(ts(g)).toEqual([0, 0.3, 1]);
  });

  it('px 指定はグラデーション線の長さで正規化する', () => {
    const g = parseLinearGradient('linear-gradient(rgb(255,0,0) 10px, rgb(0,0,255) 90px)', 200, 100);
    expect(ts(g)).toEqual([0.1, 0.9]);
  });

  it('位置の無い中間色は等間隔に並べる', () => {
    const g = parseLinearGradient('linear-gradient(rgb(255,0,0), rgb(0,255,0), rgb(0,0,255))', 100, 100);
    expect(ts(g)).toEqual([0, 0.5, 1]);
  });

  it('位置が逆行したら前の値に揃える（単調にする）', () => {
    const g = parseLinearGradient('linear-gradient(rgb(255,0,0) 60%, rgb(0,0,255) 20%)', 100, 100);
    expect(ts(g)).toEqual([0.6, 0.6]);
  });

  it('二重指定（色 位置 位置）は 2 つの色止めに展開する', () => {
    const g = parseLinearGradient('linear-gradient(rgb(255,0,0) 0% 40%, rgb(0,0,255) 60% 100%)', 100, 100);
    expect(ts(g)).toEqual([0, 0.4, 0.6, 1]);
  });

  it('アルファを保持する', () => {
    const g = parseLinearGradient('linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.5))', 100, 100);
    expect(g?.stops.map((s) => s.color.a)).toEqual([0, 0.5]);
  });

  it('in oklab などの補間指定は無視して解析する', () => {
    const g = parseLinearGradient('linear-gradient(in oklab, rgb(255, 0, 0), rgb(0, 0, 255))', 100, 100);
    expect(ts(g)).toEqual([0, 1]);
  });

  it('未対応の書式は null', () => {
    expect(parseLinearGradient('repeating-linear-gradient(rgb(255,0,0), rgb(0,0,255) 20px)', 100, 100)).toBeNull();
    expect(parseLinearGradient('radial-gradient(circle, rgb(255,0,0), rgb(0,0,255))', 100, 100)).toBeNull();
    expect(parseLinearGradient('conic-gradient(rgb(255,0,0), rgb(0,0,255))', 100, 100)).toBeNull();
    expect(parseLinearGradient('url("x.png")', 100, 100)).toBeNull();
    expect(parseLinearGradient('none', 100, 100)).toBeNull();
  });

  it('高さ 0 の箱では null（線の長さが 0）', () => {
    expect(parseLinearGradient('linear-gradient(to right, rgb(0,0,0), rgb(255,255,255))', 0, 0)).toBeNull();
  });
});
