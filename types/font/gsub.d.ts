/**
 * GSUB（グリフ置換）の単一置換だけを読む。
 *
 * ブラウザが `font-variant-*` / `font-feature-settings` で有効にした機能を、
 * 同じ結果になるように gid → gid の置換として再現する。
 * 置換は埋め込み前に解決するので、PDF に GSUB テーブル自体は入らない。
 *
 * 対応するのは Lookup タイプ 1（単一置換、フォーマット 1 / 2）と、
 * それを包むタイプ 7（拡張）だけ。タイプ 4（合字）はグリフ数が変わるため、
 * 1 文字ずつ位置を実測する走査モデルでは扱えない。
 */
/**
 * @typedef {object} GsubTable
 * @property {Map<string, number[]>} features  機能タグ → Lookup 番号
 * @property {(index: number) => Map<number, number>|null} lookup  単一置換の Lookup を読む（対応外なら null）
 */
/**
 * GSUB を読む。無い・壊れている場合は null。
 * @param {import('./parse.js').ParsedFont} font
 * @returns {GsubTable|null}
 */
export function parseGsub(font: import("./parse.js").ParsedFont): GsubTable | null;
/**
 * 機能タグの集合から置換関数を作る。Lookup 番号の小さい順に適用する。
 * @param {import('./parse.js').ParsedFont} font
 * @param {string[]} tags
 * @returns {((gid: number) => number)|null}  置換が 1 つも無ければ null
 */
export function buildSubstitution(font: import("./parse.js").ParsedFont, tags: string[]): ((gid: number) => number) | null;
/**
 * computed style から、ブラウザが有効にしている機能タグを集める。
 * 既定で有効な機能（ccmp / liga / calt）は含めない（合字は扱えないため）。
 *
 * @param {CSSStyleDeclaration} style
 * @returns {string[]}
 */
export function featureTagsOf(style: CSSStyleDeclaration): string[];
export type GsubTable = {
    /**
     * 機能タグ → Lookup 番号
     */
    features: Map<string, number[]>;
    /**
     * 単一置換の Lookup を読む（対応外なら null）
     */
    lookup: (index: number) => Map<number, number> | null;
};
