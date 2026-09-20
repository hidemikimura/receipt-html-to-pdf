// @ts-check
import { describe, it, expect } from 'vitest';
import { splitRepeat, tileAxis } from '../src/walker/image.js';

const r = (n) => Math.round(n * 1000) / 1000 + 0;
const pos = (t) => t.positions.map(r);

describe('splitRepeat', () => {
  it('1 値は両軸に適用する', () => {
    expect(splitRepeat('repeat')).toEqual(['repeat', 'repeat']);
    expect(splitRepeat('no-repeat')).toEqual(['no-repeat', 'no-repeat']);
    expect(splitRepeat('space')).toEqual(['space', 'space']);
  });

  it('repeat-x / repeat-y を 2 値に展開する', () => {
    expect(splitRepeat('repeat-x')).toEqual(['repeat', 'no-repeat']);
    expect(splitRepeat('repeat-y')).toEqual(['no-repeat', 'repeat']);
  });

  it('2 値表記をそのまま読む', () => {
    expect(splitRepeat('repeat space')).toEqual(['repeat', 'space']);
    expect(splitRepeat('round no-repeat')).toEqual(['round', 'no-repeat']);
  });

  it('未知の値は repeat 扱い', () => {
    expect(splitRepeat('')).toEqual(['repeat', 'repeat']);
    expect(splitRepeat('bogus')).toEqual(['repeat', 'repeat']);
  });
});

describe('tileAxis', () => {
  it('no-repeat は指定位置に 1 枚', () => {
    expect(pos(tileAxis('no-repeat', 30, 20, 0, 100))).toEqual([30]);
  });

  it('repeat は指定位置を基準に前後へ伸ばし、領域を覆う', () => {
    const t = tileAxis('repeat', 30, 20, 0, 100);
    expect(pos(t)).toEqual([-10, 10, 30, 50, 70, 90]);
    expect(t.size).toBe(20);
  });

  it('repeat: 位置がちょうど領域の先頭なら余分な前置きを作らない', () => {
    expect(pos(tileAxis('repeat', 0, 25, 0, 100))).toEqual([0, 25, 50, 75]);
  });

  it('round はタイルの大きさを調整して整数個収める', () => {
    // 100 / 30 = 3.33 → 3 個、大きさは 33.333
    const t = tileAxis('round', 0, 30, 0, 100);
    expect(t.positions).toHaveLength(3);
    expect(r(t.size)).toBe(33.333);
    expect(pos(t)).toEqual([0, 33.333, 66.667]);
  });

  it('round は最低 1 個（領域より大きいタイル）', () => {
    const t = tileAxis('round', 0, 300, 0, 100);
    expect(t.positions).toEqual([0]);
    expect(t.size).toBe(100);
  });

  it('space は整数個を等間隔に置き、大きさは変えない', () => {
    // 100 / 30 = 3 個、余り 10 を 2 つの隙間に 5 ずつ
    const t = tileAxis('space', 0, 30, 0, 100);
    expect(pos(t)).toEqual([0, 35, 70]);
    expect(t.size).toBe(30);
  });

  it('space は 1 枚しか入らないなら先頭に 1 枚', () => {
    expect(pos(tileAxis('space', 40, 60, 0, 100))).toEqual([0]);
  });

  it('領域の外にしかかからないタイルは作らない', () => {
    const t = tileAxis('repeat', 0, 10, 100, 130);
    expect(pos(t)).toEqual([100, 110, 120]);
  });

  it('大きさ 0 のタイルでも無限ループしない', () => {
    expect(pos(tileAxis('repeat', 5, 0, 0, 100))).toEqual([5]);
  });
});
