// @ts-check
import { describe, it, expect } from 'vitest';
import { paginate } from '../src/paginate.js';

/** @param {Partial<import('../src/walker/walk.js').WalkResult>} w */
const walk = (w) => /** @type {import('../src/walker/walk.js').WalkResult} */ ({ items: [], atoms: [], breaks: [], joins: [], tables: [], height: 0, ...w });

describe('paginate', () => {
  it('1 ページに収まるなら分割しない', () => {
    expect(paginate(walk({ height: 500 }), 1000)).toEqual([{ start: 0, end: 500, heads: [], headShift: 0, feet: [], footShift: 0 }]);
  });

  it('アトム（行）を跨がない位置まで境界を上げる', () => {
    // 行が 30px ごと、ページ高 1000 → 990〜1020 の行が境界にかかるので 990 で切る
    const atoms = Array.from({ length: 80 }, (_, i) => ({ top: i * 30, bottom: i * 30 + 30 }));
    const pages = paginate(walk({ height: 2400, atoms }), 1000);
    expect(pages.map((p) => [p.start, p.end])).toEqual([
      [0, 990],
      [990, 1980],
      [1980, 2400],
    ]);
  });

  it('連鎖するアトム（行を包む avoid ブロック）も考慮する', () => {
    const atoms = [
      { top: 900, bottom: 1100 }, // break-inside: avoid のブロック
      { top: 950, bottom: 980 }, // その中の行
      { top: 990, bottom: 1020 },
    ];
    const pages = paginate(walk({ height: 1500, atoms }), 1000);
    expect(pages[0]?.end).toBe(900);
  });

  it('break-after: avoid — 見出しと次のブロックの間で切らない', () => {
    // 見出し 960〜990、次の段落の 1 行目 990〜1020。行を跨がないよう境界が 990 に上がると
    // ちょうど見出しと段落の間になるので、見出しごと次ページへ送る
    const atoms = [
      { top: 960, bottom: 990 }, // 見出しの行
      { top: 990, bottom: 1020 }, // 段落の 1 行目
    ];
    const joins = [{ start: 990, end: 990, pullTo: 960 }];
    const pages = paginate(walk({ height: 2000, atoms, joins }), 1000);
    expect(pages[0]?.end).toBe(960);
  });

  it('break-after: avoid — 境界が次のブロックの途中なら何もしない', () => {
    // 境界 1000 は段落の 2 行目以降に落ちるので、見出しと段落は同じページに載っている
    const atoms = [
      { top: 960, bottom: 990 },
      { top: 990, bottom: 1000 },
      { top: 1000, bottom: 1030 },
    ];
    const joins = [{ start: 990, end: 990, pullTo: 960 }];
    const pages = paginate(walk({ height: 2000, atoms, joins }), 1000);
    expect(pages[0]?.end).toBe(1000);
  });

  it('break-before: avoid — 直前のブロックと離さない', () => {
    const joins = [{ start: 800, end: 850, pullTo: 700 }];
    const pages = paginate(walk({ height: 2000, joins }), 820);
    expect(pages[0]?.end).toBe(700);
  });

  it('avoid の連鎖（見出しが 2 つ続く）も遡る', () => {
    // 見出し A 920〜950、見出し B 950〜980、本文 1 行目 980〜1010
    const atoms = [
      { top: 920, bottom: 950 },
      { top: 950, bottom: 980 },
      { top: 980, bottom: 1010 },
    ];
    const joins = [
      { start: 980, end: 980, pullTo: 950 }, // 見出し B と本文
      { start: 950, end: 950, pullTo: 920 }, // 見出し A と見出し B
    ];
    const pages = paginate(walk({ height: 2000, atoms, joins }), 1000);
    expect(pages[0]?.end).toBe(920);
  });

  it('結んだ範囲がページに収まらない avoid は諦める', () => {
    // 1500px 分を結んでいるのでページ（1000）に収まらない。容量いっぱいで切る
    const joins = [{ start: 900, end: 1000, pullTo: 0 }];
    const pages = paginate(walk({ height: 2000, joins }), 1000);
    expect(pages[0]?.end).toBe(1000);
  });

  it('戻すとページが空になる avoid は諦める', () => {
    // ページ先頭（0）が戻し先なので戻せない
    const joins = [{ start: 500, end: 500, pullTo: 0 }];
    const pages = paginate(walk({ height: 2000, joins }), 500);
    expect(pages[0]?.end).toBe(500);
  });

  it('ページより大きいアトムは容量いっぱいで切る（空ページを作らない）', () => {
    const pages = paginate(walk({ height: 3000, atoms: [{ top: 10, bottom: 2500 }] }), 1000);
    expect(pages.map((p) => [p.start, p.end])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
    ]);
  });

  it('強制改ページで切る', () => {
    const pages = paginate(walk({ height: 1200, breaks: [300, 300, 700] }), 1000);
    expect(pages.map((p) => [p.start, p.end])).toEqual([
      [0, 300],
      [300, 700],
      [700, 1200],
    ]);
  });

  it('表が続くページでは thead を繰り返し、その分だけ容量を減らす', () => {
    const table = { top: 100, bottom: 2500, headTop: 100, headBottom: 140, headItems: [/** @type {any} */ ({ type: 'rect' })], footTop: 0, footBottom: 0, footItems: [] };
    const rows = Array.from({ length: 60 }, (_, i) => ({ top: 140 + i * 40, bottom: 180 + i * 40 }));
    const pages = paginate(walk({ height: 2600, atoms: rows, tables: [table] }), 1000);
    expect(pages[0]?.heads).toEqual([]);
    expect(pages[1]?.heads.length).toBe(1);
    expect(pages[1]?.headShift).toBe(40);
    // 2 ページ目の本文は 1000 − 40 = 960 以下
    const p1 = /** @type {import('../src/paginate.js').PageRange} */ (pages[1]);
    expect(p1.end - p1.start).toBeLessThanOrEqual(960);
    // 表が終わった後のページでは繰り返さない
    const last = /** @type {import('../src/paginate.js').PageRange} */ (pages[pages.length - 1]);
    if (last.start >= 2500) expect(last.heads).toEqual([]);
  });

  it('表が次ページへ続くページでは tfoot を末尾に繰り返し、表が終わるページでは繰り返さない', () => {
    const table = {
      top: 0,
      bottom: 1560,
      headTop: 0,
      headBottom: 40,
      headItems: [/** @type {any} */ ({ type: 'rect' })],
      footTop: 1520,
      footBottom: 1560,
      footItems: [/** @type {any} */ ({ type: 'rect' })],
    };
    const rows = Array.from({ length: 37 }, (_, i) => ({ top: 40 + i * 40, bottom: 80 + i * 40 }));
    const pages = paginate(walk({ height: 1560, atoms: [...rows, { top: 1520, bottom: 1560 }], tables: [table] }), 1000);
    expect(pages.length).toBe(2);
    const p0 = /** @type {import('../src/paginate.js').PageRange} */ (pages[0]);
    const p1 = /** @type {import('../src/paginate.js').PageRange} */ (pages[1]);
    expect(p0.feet.length).toBe(1);
    expect(p0.footShift).toBe(40);
    // 容量 1000 − tfoot 40 = 960 → 行境界 960 で切れる
    expect(p0.end).toBe(960);
    expect(p1.heads.length).toBe(1);
    expect(p1.feet).toEqual([]); // 本来の tfoot がこのページに載る
  });
});
