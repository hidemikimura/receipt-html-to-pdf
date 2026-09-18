// @ts-check
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseTransform } from '../src/walker/walk.js';
import { fitImage, jpegDimensions, parseBackgroundUrl, objectFitToSize } from '../src/walker/image.js';
import { parseContentString, expandPrintMediaCss } from '../src/renderer.js';
import { ContentStream } from '../src/pdf/content.js';

describe('parseTransform', () => {
  it('matrix() を解析し、恒等変換と 3D は null にする', () => {
    expect(parseTransform('none')).toBeNull();
    expect(parseTransform('matrix(1, 0, 0, 1, 0, 0)')).toBeNull();
    expect(parseTransform('matrix(0.88, -0.47, 0.47, 0.88, -100, 20)')).toEqual([0.88, -0.47, 0.47, 0.88, -100, 20]);
    expect(parseTransform('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)')).toBeNull();
  });
});

describe('image helpers', () => {
  it('JPEG の寸法と成分数を読む', () => {
    const jpg = readFileSync(new URL('../fixtures/receipt-invoice/assets/logo.jpg', import.meta.url));
    expect(jpegDimensions(new Uint8Array(jpg))).toEqual({ width: 800, height: 200, components: 3 });
  });
  it('background-image の url() を取り出す', () => {
    expect(parseBackgroundUrl('url("http://x/a.png")')).toBe('http://x/a.png');
    expect(parseBackgroundUrl('none')).toBeNull();
    expect(parseBackgroundUrl('linear-gradient(red, blue)')).toBeNull();
    expect(parseBackgroundUrl('url("a.png"), url("b.png")')).toBeNull();
  });
  it('cover / contain / 明示サイズ / 位置を計算する', () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    expect(fitImage(box, 100, 100, 'contain', '50% 50%')).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(fitImage(box, 100, 100, 'cover', '50% 50%')).toEqual({ x: 0, y: -50, w: 200, h: 200 });
    expect(fitImage(box, 100, 50, 'auto', '0% 0%')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(fitImage(box, 100, 50, '50px auto', '100% 100%')).toEqual({ x: 150, y: 75, w: 50, h: 25 });
    expect(fitImage(box, 100, 50, '100% 100%', '0% 0%')).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(objectFitToSize('fill')).toBe('100% 100%');
  });
});

describe('pseudo-element content', () => {
  it('文字列 content を復号し、それ以外は null', () => {
    expect(parseContentString('"※ "')).toBe('※ ');
    expect(parseContentString("'a' \"b\"")).toBe('ab');
    expect(parseContentString('"\\203B "')).toBe('※');
    expect(parseContentString('counter(item) ". "')).toBeNull();
    expect(parseContentString('url("x.png")')).toBeNull();
  });
});

describe('expandPrintMediaCss', () => {
  it('@media print を展開し screen を捨てる', () => {
    const css = 'a{color:red}@media print{a{color:blue}}@media screen{a{display:none}}@media (min-width:600px){b{x:y}}';
    expect(expandPrintMediaCss(css)).toBe('a{color:red}a{color:blue}@media (min-width:600px){b{x:y}}');
  });
});

describe('ContentStream.roundedRect', () => {
  it('半径が矩形の半分を超えないように丸める', () => {
    const cs = new ContentStream().roundedRect(0, 0, 10, 10, [100, 0, 0, 0]);
    const text = new TextDecoder().decode(cs.toBytes());
    expect(text).toContain('5 10 m'); // 半径が 5 に丸められている
    expect(text.trim().endsWith('h')).toBe(true);
  });
});
