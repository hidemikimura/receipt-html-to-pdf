/**
 * Paginator — 走査結果（アトム・強制改ページ・テーブル）から各ページの縦範囲を決める。
 *
 * 方針: 命令は動かさず、ページごとに「この y 範囲を描く」と決めるだけにする。
 * 境界は、アトム（テキスト行・表の行・画像・break-inside: avoid）を跨がない位置まで上へ戻す。
 * `break-before/after: avoid` で結ばれた箱の間にも境界を置かず、置きそうなら前の箱の先頭まで戻す。
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
export function paginate(walk: import("./walker/walk.js").WalkResult, pageHeightPx: number): PageRange[];
export type RepeatedHead = {
    table: import("./walker/walk.js").TableInfo;
    /**
     * このページで thead を描く位置（ページ先頭からの px オフセット）
     */
    shift: number;
};
export type PageRange = {
    /**
     * 本文の描き始め y（ドキュメント px）
     */
    start: number;
    /**
     * 本文の描き終わり y（この値未満を描く）
     */
    end: number;
    /**
     * ページ先頭で繰り返す thead
     */
    heads: RepeatedHead[];
    /**
     * 繰り返し thead の合計高さ（本文はこの分だけ下がる）
     */
    headShift: number;
    /**
     * ページ末尾で繰り返す tfoot（表が次ページへ続くとき）
     */
    feet: RepeatedHead[];
    /**
     * 繰り返し tfoot の合計高さ（本文領域はこの分だけ縮む）
     */
    footShift: number;
};
