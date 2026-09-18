// @ts-check
import { describe, it, expect } from 'vitest';
import { PdfWriter, serialize, pdfString, Name, Raw, Ref } from '../src/pdf/writer.js';
import { ContentStream } from '../src/pdf/content.js';
import { parseColor, lengthToPt, num } from '../src/units.js';

describe('serialize', () => {
  it('基本型と辞書・配列を PDF 構文にする', () => {
    expect(serialize(1.5)).toBe('1.5');
    expect(serialize(2)).toBe('2');
    expect(serialize(true)).toBe('true');
    expect(serialize(null)).toBe('null');
    expect(serialize('Type')).toBe('/Type');
    expect(serialize(new Name('a b'))).toBe('/a#20b');
    expect(serialize(new Ref(3))).toBe('3 0 R');
    expect(serialize([1, 'A', new Raw('(x)')])).toBe('[1 /A (x)]');
    expect(serialize({ Type: 'Catalog', Kids: [] })).toBe('<< /Type /Catalog /Kids [] >>');
  });

  it('pdfString は ASCII をリテラル、非 ASCII を UTF-16BE 16 進にする', () => {
    expect(serialize(pdfString('a(b)'))).toBe('(a\\(b\\))');
    expect(serialize(pdfString('領'))).toBe('<FEFF9818>');
  });
});

describe('PdfWriter', () => {
  it('xref のオフセットが各オブジェクトの先頭を指す', async () => {
    const w = new PdfWriter({ compress: false });
    const pages = w.reserve();
    const cs = new ContentStream().save().fillColor(0, 0, 0).fillRect(10, 10, 100, 50).restore();
    const content = await w.addStream({}, cs.toBytes());
    const page = w.add({ Type: 'Page', Parent: pages, MediaBox: [0, 0, 200, 200], Contents: content });
    w.set(pages, { Type: 'Pages', Kids: [page], Count: 1 });
    const catalog = w.add({ Type: 'Catalog', Pages: pages });
    const bytes = w.build(catalog);
    const text = new TextDecoder('latin1').decode(bytes);

    expect(text.startsWith('%PDF-1.7\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(4);
    entries.forEach((off, i) => {
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(text).toMatch(/\/Length \d+ >>\nstream\n/);
  });

  it('ContentStream は q/Q の対応を検査する', () => {
    expect(() => new ContentStream().save().toBytes()).toThrow();
    expect(() => new ContentStream().restore()).toThrow();
  });
});

describe('units', () => {
  it('色をパースする', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgba(0, 0, 0, 0)')?.a).toBe(0);
    expect(parseColor('transparent')?.a).toBe(0);
    expect(parseColor('#336699')).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 });
  });
  it('長さを pt に変換する', () => {
    expect(lengthToPt('15mm')).toBeCloseTo(42.52, 2);
    expect(lengthToPt('96px')).toBe(72);
    expect(lengthToPt('1in')).toBe(72);
    expect(num(1.23456)).toBe('1.235');
    expect(num(2)).toBe('2');
    expect(num(-0.0001)).toBe('0');
  });
});
