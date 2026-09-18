// @ts-check
/**
 * Paginator — 走査結果（アトム・強制改ページ・テーブル）から各ページの縦範囲を決める。
 *
 * 方針: 命令は動かさず、ページごとに「この y 範囲を描く」と決めるだけにする。
 * 境界は、アトム（テキスト行・表の行・画像・break-inside: avoid）を跨がない位置まで上へ戻す。
 * テーブルが次ページへ続くときは thead を各ページ先頭で繰り返し、その高さ分だけ本文を下げる。
 */

/**
 * @typedef {object} RepeatedHead
 * @property {import('./walker/walk.js').TableInfo} table
 * @property {number} shift   このページで thead を描く位置（ページ先頭からの px オフセット）
 *
 * @typedef {object} PageRange
 * @property {number} start   本文の描き始め y（ドキュメント px）
 * @property {number} end     本文の描き終わり y（この値未満を描く）
 * @property {RepeatedHead[]} heads  ページ先頭で繰り返す thead
 * @property {number} headShift  繰り返し thead の合計高さ（本文はこの分だけ下がる）
 * @property {RepeatedHead[]} feet   ページ末尾で繰り返す tfoot（表が次ページへ続くとき）
 * @property {number} footShift  繰り返し tfoot の合計高さ（本文領域はこの分だけ縮む）
 */

/**
 * @param {import('./walker/walk.js').WalkResult} walk
 * @param {number} pageHeightPx  本文領域の高さ（px）
 * @returns {PageRange[]}
 */
export function paginate(walk, pageHeightPx) {
  const H = pageHeightPx;
  const total = walk.height;
  const atoms = [...walk.atoms].sort((a, b) => a.top - b.top);
  const breaks = [...new Set(walk.breaks)].sort((a, b) => a - b);
  const EPS = 0.01;

  /** @type {PageRange[]} */
  const pages = [];
  let start = 0;
  let guard = 0;
  while (start < total - EPS && guard++ < 10000) {
    // このページの先頭で繰り返す thead: ページ開始位置が表の途中にあり、thead が既に前ページで描かれている表
    /** @type {RepeatedHead[]} */
    const heads = [];
    let headShift = 0;
    for (const t of walk.tables) {
      if (t.headItems.length && t.headBottom <= start + EPS && start < t.bottom - EPS) {
        heads.push({ table: t, shift: headShift });
        headShift += t.headBottom - t.headTop;
      }
    }
    // tfoot の繰り返しは「このページで表が終わらない」ときだけ必要で、それは end に依存する。
    // まず tfoot 無しで end を求め、繰り返しが必要な表があれば容量を減らして計算し直す（数回で収束する）。
    /** @type {RepeatedHead[]} */
    let feet = [];
    let footShift = 0;
    let end = start;
    for (let pass = 0; pass < 4; pass++) {
      const capacity = Math.max(H - headShift - footShift, H * 0.25); // thead/tfoot が異常に高い場合の下限
      end = computeEnd(start, capacity);
      /** @type {RepeatedHead[]} */
      const needed = [];
      let shift = 0;
      for (const t of walk.tables) {
        // 表がこのページの途中から始まる・または続いていて、かつこのページで終わらない（本来の tfoot が次ページ以降）
        if (t.footItems.length && t.top < end - EPS && t.footTop >= end - EPS && t.bottom > end + EPS) {
          needed.push({ table: t, shift });
          shift += t.footBottom - t.footTop;
        }
      }
      const same = needed.length === feet.length && needed.every((n, i) => n.table === feet[i]?.table);
      feet = needed;
      footShift = shift;
      if (same) break;
    }

    pages.push({ start, end, heads, headShift, feet, footShift });
    start = end;
  }
  if (!pages.length) pages.push({ start: 0, end: Math.max(total, 1), heads: [], headShift: 0, feet: [], footShift: 0 });
  return pages;

  /**
   * start から容量 capacity のページの終端を、強制改ページとアトムを考慮して決める。
   * @param {number} start
   * @param {number} capacity
   */
  function computeEnd(start, capacity) {
    let end = Math.min(start + capacity, total);

    // 強制改ページ: (start, end) の中で最初のもの
    for (const b of breaks) {
      if (b > start + EPS && b < end - EPS) {
        end = b;
        break;
      }
    }

    // アトムを跨がない位置まで境界を上げる（他のアトムに連鎖することがあるので繰り返す）
    if (end < total - EPS) {
      let moved = true;
      let iter = 0;
      while (moved && iter++ < 1000) {
        moved = false;
        for (const a of atoms) {
          if (a.top >= end) break;
          // ページ容量より大きいアトムはどこかで切らざるを得ないので無視する
          if (a.bottom - a.top > capacity) continue;
          if (a.top < end - EPS && a.bottom > end + EPS && a.top > start + EPS) {
            end = a.top;
            moved = true;
          }
        }
      }
      // 上げ過ぎて空ページになる場合（ページより大きいアトム）は容量いっぱいで切る
      if (end <= start + EPS) end = Math.min(start + capacity, total);
    }
    return end;
  }
}
