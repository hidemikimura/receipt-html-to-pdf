// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseFont, glyphData } from '../src/font/parse.js';
import { subsetFont } from '../src/font/subset.js';
import { FontRegistry, splitFamilies, parseWeight } from '../src/font/registry.js';

const REGULAR = new URL('../fonts/BIZUDPGothic-Regular.ttf', import.meta.url);
const BOLD = new URL('../fonts/BIZUDPGothic-Bold.ttf', import.meta.url);
const hasFonts = existsSync(REGULAR) && existsSync(BOLD);

describe.skipIf(!hasFonts)('font parse / subset (BIZ UDPGothic)', () => {
  const font = parseFont(readFileSync(REGULAR));

  it('主要テーブルを読める', () => {
    expect(font.unitsPerEm).toBe(2048);
    expect(font.numGlyphs).toBeGreaterThan(10000);
    expect(font.postScriptName).toBe('BIZUDPGothic-Regular');
    expect(font.cmap.get(0x9818 /* 領 */)).toBeGreaterThan(0);
    expect(font.cmap.get(0xffe5 /* ￥ */)).toBeGreaterThan(0);
    expect(font.cmap.get(0x3000 /* 全角スペース */)).toBeGreaterThan(0);
  });

  it('サブセットは使用グリフ + .notdef だけを含み、幅を保つ', () => {
    const text = '領収証￥41,936';
    const gids = [...text].map((ch) => /** @type {number} */ (font.cmap.get(/** @type {number} */ (ch.codePointAt(0)))));
    const sub = subsetFont(font, gids);
    expect(sub.oldGids[0]).toBe(0);
    expect(sub.oldGids.length).toBe(new Set([0, ...gids]).size);
    expect(sub.data.length).toBeLessThan(font.data.length / 50);

    const re = parseFont(sub.data.buffer.slice(sub.data.byteOffset, sub.data.byteOffset + sub.data.byteLength));
    expect(re.numGlyphs).toBe(sub.oldGids.length);
    for (const g of gids) {
      const n = /** @type {number} */ (sub.gidMap.get(g));
      expect(re.advances[n]).toBe(font.advances[g]);
      // サブセットでは 4 バイト境界にパディングされるので、元グリフ長の範囲で比較する
      const orig = glyphData(font, g);
      expect(Array.from(glyphData(re, n).subarray(0, orig.length))).toEqual(Array.from(orig));
    }
  });

  it('CFF / WOFF は明確なエラーになる', () => {
    const otto = new Uint8Array(12);
    otto.set([0x4f, 0x54, 0x54, 0x4f]);
    expect(() => parseFont(otto)).toThrow(/CFF/);
    const woff = new Uint8Array(12);
    woff.set([0x77, 0x4f, 0x46, 0x46]);
    expect(() => parseFont(woff)).toThrow(/WOFF/);
  });
});

describe.skipIf(!hasFonts)('FontRegistry', () => {
  it('weight に最も近いフェイスを選ぶ', async () => {
    const reg = new FontRegistry();
    await reg.register({ family: 'BIZ UDPGothic', weight: 400, src: new Uint8Array(readFileSync(REGULAR)) });
    await reg.register({ family: 'BIZ UDPGothic', weight: 700, src: new Uint8Array(readFileSync(BOLD)) });
    expect(reg.match(['"BIZ UDPGothic"', 'sans-serif'], 400, 'normal')?.weight).toBe(400);
    expect(reg.match(['BIZ UDPGothic'], 600, 'normal')?.weight).toBe(700);
    expect(reg.match(['BIZ UDPGothic'], 300, 'normal')?.weight).toBe(400);
    expect(reg.match(['BIZ UDPGothic'], 900, 'italic')?.weight).toBe(700);
    expect(reg.match(['Helvetica'], 400, 'normal')).toBeNull();
  });
});

describe('CSS font helpers', () => {
  it('font-family リストを分割する', () => {
    expect(splitFamilies('"BIZ UDPGothic", \'Noto Sans JP\', sans-serif')).toEqual(['BIZ UDPGothic', 'Noto Sans JP', 'sans-serif']);
  });
  it('font-weight を数値にする', () => {
    expect(parseWeight('bold')).toBe(700);
    expect(parseWeight('400')).toBe(400);
    expect(parseWeight('normal')).toBe(400);
  });
});
