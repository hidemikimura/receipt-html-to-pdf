// @ts-check
// 実フォント（BIZ UDPGothic）に対して GSUB パーサを検証する。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseFont } from '../src/font/parse.js';
import { parseGsub, buildSubstitution, featureTagsOf } from '../src/font/gsub.js';

const FONT = new URL('../fonts/BIZUDPGothic-Regular.ttf', import.meta.url).pathname;
const has = existsSync(FONT);

/** @type {import('../src/font/parse.js').ParsedFont} */
let font;
beforeAll(async () => {
  if (has) font = parseFont(await readFile(FONT));
});

describe.skipIf(!has)('parseGsub（BIZ UDPGothic）', () => {
  it('機能タグを読める', () => {
    const gsub = parseGsub(font);
    expect(gsub).not.toBeNull();
    const tags = [...(gsub?.features.keys() ?? [])].sort();
    // このフォントが実際に持っているもの
    expect(tags).toContain('zero');
    expect(tags).toContain('fwid');
    expect(tags).toContain('jp90');
    expect(tags).toContain('trad');
    // 持っていないもの（調査で確認済み。tabular-nums は GSUB では直せない）
    expect(tags).not.toContain('tnum');
    expect(tags).not.toContain('onum');
  });

  it('zero はゼロを別のグリフ（スラッシュ付き）に置き換える', () => {
    const sub = buildSubstitution(font, ['zero']);
    expect(sub).not.toBeNull();
    const zero = /** @type {number} */ (font.cmap.get(0x30));
    expect(zero).toBeGreaterThan(0);
    const replaced = /** @type {(g: number) => number} */ (sub)(zero);
    expect(replaced).not.toBe(zero);
    expect(replaced).toBeLessThan(font.numGlyphs);
    // 他の数字は変わらない
    expect(/** @type {(g: number) => number} */ (sub)(/** @type {number} */ (font.cmap.get(0x31)))).toBe(font.cmap.get(0x31));
  });

  it('fwid は半角円記号を全角に置き換える', () => {
    const sub = /** @type {(g: number) => number} */ (buildSubstitution(font, ['fwid']));
    const half = /** @type {number} */ (font.cmap.get(0xa5)); // ¥
    const full = /** @type {number} */ (font.cmap.get(0xffe5)); // ￥
    expect(sub(half)).toBe(full);
  });

  it('jp90 は異体字に置き換える（旧字体まわり）', () => {
    const sub = buildSubstitution(font, ['jp90']);
    expect(sub).not.toBeNull();
    // 置き換わる文字が 1 つ以上ある
    let changed = 0;
    for (const [, gid] of font.cmap) if (/** @type {(g: number) => number} */ (sub)(gid) !== gid) changed++;
    expect(changed).toBeGreaterThan(0);
  });

  it('無い機能タグでは null（置換なし）', () => {
    expect(buildSubstitution(font, ['tnum'])).toBeNull();
    expect(buildSubstitution(font, [])).toBeNull();
  });

  it('未対応の Lookup 種別しか無い機能は null になる（合字など）', () => {
    // liga はタイプ 4（合字）なので単一置換としては読めない
    expect(buildSubstitution(font, ['liga'])).toBeNull();
  });

  it('置換は Lookup 番号の順に合成される', () => {
    const both = /** @type {(g: number) => number} */ (buildSubstitution(font, ['zero', 'fwid']));
    const zeroOnly = /** @type {(g: number) => number} */ (buildSubstitution(font, ['zero']));
    const fwidOnly = /** @type {(g: number) => number} */ (buildSubstitution(font, ['fwid']));
    const zero = /** @type {number} */ (font.cmap.get(0x30));
    const yen = /** @type {number} */ (font.cmap.get(0xa5));
    expect(both(zero)).toBe(zeroOnly(zero));
    expect(both(yen)).toBe(fwidOnly(yen));
  });
});

describe('featureTagsOf', () => {
  /** @param {Record<string, string>} props */
  const style = (props) => /** @type {CSSStyleDeclaration} */ (/** @type {unknown} */ ({ fontVariantNumeric: 'normal', fontVariantCaps: 'normal', fontVariantEastAsian: 'normal', fontFeatureSettings: 'normal', ...props }));

  it('既定では何も有効にしない', () => {
    expect(featureTagsOf(style({}))).toEqual([]);
  });

  it('font-variant-numeric を機能タグに写す', () => {
    expect(featureTagsOf(style({ fontVariantNumeric: 'slashed-zero' }))).toEqual(['zero']);
    expect(featureTagsOf(style({ fontVariantNumeric: 'tabular-nums slashed-zero' })).sort()).toEqual(['tnum', 'zero']);
  });

  it('font-variant-east-asian を機能タグに写す', () => {
    expect(featureTagsOf(style({ fontVariantEastAsian: 'jis90 full-width' })).sort()).toEqual(['fwid', 'jp90']);
  });

  it('font-variant-caps を機能タグに写す', () => {
    expect(featureTagsOf(style({ fontVariantCaps: 'small-caps' }))).toEqual(['smcp']);
  });

  it('font-feature-settings を読み、0 / off は無視する', () => {
    expect(featureTagsOf(style({ fontFeatureSettings: '"zero" 1, "jp90"' })).sort()).toEqual(['jp90', 'zero']);
    expect(featureTagsOf(style({ fontFeatureSettings: '"zero" 0' }))).toEqual([]);
    expect(featureTagsOf(style({ fontFeatureSettings: '"liga" off' }))).toEqual([]);
  });

  it('重複は 1 つにまとめる', () => {
    expect(featureTagsOf(style({ fontVariantNumeric: 'slashed-zero', fontFeatureSettings: '"zero" 1' }))).toEqual(['zero']);
  });
});
